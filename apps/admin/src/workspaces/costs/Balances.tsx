import { useData } from '@/data/store';
import { Notice } from '@/ui/kit';
import { BalanceCards } from './BalanceCards';
import { CostsHead } from './parts';

/** Service balances (D-068): what pay per use providers cost, what is used and what is left, in our own admin. */
export default function Balances() {
  const d = useData();
  return (
    <>
      <CostsHead title="Service balances" sub="Pay per use services: money left, spent and how far it goes." />
      <Notice tone="info">Simulated until each service is connected. Then balances come from the provider or our own records, never their site.</Notice>
      <div className="section">
        <BalanceCards integrations={d.integrations} />
      </div>
    </>
  );
}
