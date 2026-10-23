import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { Errors } from './errors';

/** Turns zod issues into the envelope's `details` ({ field: message }); first message per field. */
export function zodDetails(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const field = i.path.length ? i.path.join('.') : '_';
    if (!(field in out)) out[field] = i.message;
  }
  return out;
}

/** Validates and parses one argument (body, query or param) with a zod schema. Unknown keys are rejected. */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown, _meta: ArgumentMetadata): z.infer<S> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) throw Errors.validation(zodDetails(r.error));
    return r.data;
  }
}

export const validate = <S extends z.ZodType>(schema: S) => new ZodPipe(schema);
