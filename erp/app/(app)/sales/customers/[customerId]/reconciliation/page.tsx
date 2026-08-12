import { notFound } from 'next/navigation';
import { ReconAct } from '@/components/recon-act';
import { queryOne } from '@/lib/db';
import { customerReconciliation } from '@/lib/reconciliation';
import { isoDay } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Акт звірки з клієнтом: від юрособи, обраної в перемикачі. */
export default async function CustomerReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireRole('sales');
  const { customerId } = await params;
  const sp = await searchParams;

  const today = isoDay(new Date()) ?? '';
  const from = sp.from || `${today.slice(0, 4)}-01-01`;
  const to = sp.to || today;

  const [customer, entity] = await Promise.all([
    queryOne<{ name: string; edrpou: string | null }>(
      'select name, edrpou from customers where id = $1',
      [customerId],
    ),
    queryOne<{ name: string; edrpou: string | null; director_name: string | null; director_position: string }>(
      'select name, edrpou, director_name, director_position from legal_entities where id = $1',
      [session.eid],
    ),
  ]);
  if (!customer || !entity) notFound();

  const data = await customerReconciliation(customerId, session.eid, from, to);

  return (
    <ReconAct
      data={data}
      from={from}
      to={to}
      ourName={entity.name}
      ourEdrpou={entity.edrpou}
      ourDirector={entity.director_name}
      ourDirectorPosition={entity.director_position}
      theirName={customer.name}
      theirEdrpou={customer.edrpou}
      positiveMeans={`заборгованість на користь ${entity.name}`}
      negativeMeans={`заборгованість на користь ${customer.name}`}
      backHref={`/sales/customers/${customerId}`}
      periodFormAction={`/sales/customers/${customerId}/reconciliation`}
    />
  );
}
