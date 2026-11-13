import { useData } from '@/data/store';
import { Notice } from '@/ui/kit';
import { BalanceCards } from './BalanceCards';
import { CostsHead } from './parts';

/** Service balances (D-068): what pay per use providers cost, what is used and what is left, in our own admin. */
export default function Balances() {
  const d = useData();
  return (
    <>
      <CostsHead title="Service balances" sub="Services we pay for per use, such as identity checks and sign in codes: money left, money spent and how many more uses it covers." />
      <Notice tone="info">
        These figures are simulated. Once each service is connected, the system reads the balance from the provider, or works it out from our own record of every use. Nobody needs to open the provider’s site to check.
      </Notice>
      <div className="section">
        <BalanceCards integrations={d.integrations} />
      </div>
    </>
  );
}
