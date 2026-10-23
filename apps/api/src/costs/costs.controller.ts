import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { breakEven, OPERATING_CATEGORIES, type Kobo } from '@gobye/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DATABASE } from '../tokens';
import type { Database } from '../database/database';
import { CurrentPrincipal, RequirePermission } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { Errors } from '../common/errors';
import { validate } from '../common/validation';
import { parseIdempotencyKey, requestHash, withIdempotency } from '../database/idempotency';

/**
 * Infrastructure and operating costs (D-057) for profitability reporting. Records only: no money moves.
 * Break-even follows the agreed rule: operating costs exclude marketing (core OPERATING_CATEGORIES); only
 * approved or paid expenses count; revenue is driver pass payments confirmed in the month, minus passes
 * refunded or reversed (0% trip commission, so passes are the revenue).
 */

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');

export const CreateExpense = z
  .object({
    vendorId: z.string().regex(/^[a-z0-9-]{3,40}$/, 'Choose the vendor.'),
    description: z.string().trim().min(3, 'Say what the cost is for.').max(200),
    amountKobo: z.number().int('Whole kobo only.').positive('Enter an amount above ₦0.').max(1_000_000_000_00, 'Too large.'),
    month: Month,
    incurredAt: z.string().datetime({ offset: true, message: 'Use an ISO date and time.' }),
    recurring: z.boolean().default(false),
    original: z.object({ currency: z.literal('USD'), cents: z.number().int().positive(), fxRate: z.number().positive().max(100_000) }).strict().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
type CreateExpense = z.infer<typeof CreateExpense>;

const MonthQuery = z.object({ month: Month }).strict();

interface ExpenseRow {
  id: string;
  vendor_id: string;
  category: string;
  description: string;
  amount_kobo: string;
  month: string;
  status: string;
  recurring: boolean;
  incurred_at: Date;
  created_at: Date;
}
const dto = (r: ExpenseRow) => ({
  id: r.id,
  vendorId: r.vendor_id,
  category: r.category,
  description: r.description,
  amountKobo: Number(r.amount_kobo),
  month: r.month,
  status: r.status,
  recurring: r.recurring,
  incurredAt: r.incurred_at.toISOString(),
  createdAt: r.created_at.toISOString(),
});

/** Month boundaries in Lagos time (WAT, UTC+1, no daylight saving). */
export function lagosMonthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1) - 3_600_000), to: new Date(Date.UTC(y, m, 1) - 3_600_000) };
}

@Controller('costs')
export class CostsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post('expenses')
  @HttpCode(201)
  @RequirePermission('costs.manage')
  async create(
    @Body(validate(CreateExpense)) body: CreateExpense,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const idem = parseIdempotencyKey(key);
    const staff = p.staff!;
    const out = await withIdempotency(this.db, { scope: `staff:${staff.id}`, key: idem, method: 'POST', path: '/v1/costs/expenses', hash: requestHash('POST', '/v1/costs/expenses', body) }, async (tx) => {
      const vendor = (await tx.query<{ category: string }>(`select category from app.vendors where id = $1`, [body.vendorId])).rows[0];
      if (!vendor) throw Errors.validation({ vendorId: 'Choose the vendor.' });
      const row = (
        await tx.query<ExpenseRow>(
          `insert into app.operating_expenses (vendor_id, category, description, amount_kobo, month, original_currency, original_amount_minor, fx_rate, incurred_at, recurring, note, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning id, vendor_id, category, description, amount_kobo, month, status, recurring, incurred_at, created_at`,
          [body.vendorId, vendor.category, body.description, body.amountKobo, body.month, body.original?.currency ?? null, body.original?.cents ?? null, body.original?.fxRate ?? null, body.incurredAt, body.recurring, body.note ?? null, staff.id],
        )
      ).rows[0]!;
      await tx.query(
        `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, request_id, data)
         values ('staff', $1, $2, 'costs.expense_recorded', 'expense', $3, $4, $5, $6::jsonb)`,
        [staff.id, `staff:${staff.id}`, row.id, `Recorded ${body.vendorId} expense for ${body.month}`, req.id, JSON.stringify({ amountKobo: body.amountKobo, month: body.month })],
      );
      return { status: 201, body: dto(row) };
    });
    reply.status(out.status);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return out.body;
  }

  @Get('expenses')
  @RequirePermission('costs.view')
  async list(@Query(validate(MonthQuery)) q: z.infer<typeof MonthQuery>) {
    const r = await this.db.query<ExpenseRow>(
      `select id, vendor_id, category, description, amount_kobo, month, status, recurring, incurred_at, created_at
         from app.operating_expenses where month = $1 order by incurred_at, id`,
      [q.month],
    );
    return { items: r.rows.map(dto) };
  }

  @Get('break-even')
  @RequirePermission('costs.view')
  async breakEvenReport(@Query(validate(MonthQuery)) q: z.infer<typeof MonthQuery>) {
    const costs = await this.db.query<{ category: string; status: string; total: string }>(
      `select category, status, sum(amount_kobo)::bigint as total from app.operating_expenses where month = $1 group by category, status`,
      [q.month],
    );
    const counted = new Set(['approved', 'paid']);
    const operating = new Set<string>(OPERATING_CATEGORIES);
    let operatingCost = 0;
    let marketingCost = 0;
    let pendingCost = 0;
    for (const r of costs.rows) {
      const n = Number(r.total);
      if (!counted.has(r.status)) { if (r.status === 'pending_approval' || r.status === 'draft') pendingCost += n; continue; }
      if (operating.has(r.category)) operatingCost += n;
      else marketingCost += n;
    }
    const { from, to } = lagosMonthRange(q.month);
    const rev = await this.db.query<{ total: string; passes: number }>(
      `select coalesce(sum(p.amount_kobo), 0)::bigint as total, count(*)::int as passes
         from app.driver_pass_payments p
         left join app.driver_pass_voids v on v.payment_ref = p.payment_ref and v.kind in ('refunded', 'reversed')
        where p.confirmed_at >= $1 and p.confirmed_at < $2 and v.payment_ref is null`,
      [from, to],
    );
    const subscriptionRevenue = Number(rev.rows[0]!.total);
    return {
      month: q.month,
      ...breakEven({ operatingCost: operatingCost as Kobo, subscriptionRevenue: subscriptionRevenue as Kobo }),
      passesSold: rev.rows[0]!.passes,
      excluded: { marketingCostKobo: marketingCost, pendingApprovalKobo: pendingCost },
      rules: 'Operating costs exclude marketing; only approved or paid expenses count; revenue is driver passes confirmed in the month (Lagos time) less refunds and reversals; 0% trip commission.',
    };
  }
}
