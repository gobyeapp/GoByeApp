import { useData } from '@/data/store';
import { BalanceCards } from './BalanceCards';
import { CostsHead } from './parts';

/** Service balances (D-068): what pay per use providers cost, what is used and what is left, in our own admin. */
export default function Balances() {
  const d = useData();
  return (
    <>
      <CostsHead title="Service balances" sub="Pay per use services: money left, spent and how far it goes." />
      <div className="section">
        <BalanceCards integrations={d.integrations} />
      </div>
    </>
  );
}
