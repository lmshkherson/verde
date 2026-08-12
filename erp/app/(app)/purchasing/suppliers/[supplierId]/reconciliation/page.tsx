import { notFound } from 'next/navigation';
import { ReconAct } from '@/components/recon-act';
import { queryOne } from '@/lib/db';
import { supplierReconciliation } from '@/lib/reconciliation';
import { isoDay } from '@/lib/format';
import { requireRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Акт звірки з постачальником: від юрособи, обраної в перемикачі. */
export default async function SupplierReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireRole('warehouse');
  const { supplierId } = await params;
  const sp = await searchParams;

  const today = isoDay(new Date()) ?? '';
  const from = sp.from || `${today.slice(0, 4)}-01-01`;
  const to = sp.to || today;

  const [supplier, entity] = await Promise.all([
    queryOne<{ name: string; edrpou: string | null }>(
      'select name, edrpou from suppliers where id = $1',
      [supplierId],
    ),
    queryOne<{ name: string; edrpou: string | null; director_name: string | null; director_position: string }>(
      'select name, edrpou, director_name, director_position from legal_entities where id = $1',
      [session.eid],
    ),
  ]);
  if (!supplier || !entity) notFound();

  const data = await supplierReconciliation(supplierId, session.eid, from, to);

  return (
    <ReconAct
      data={data}
      from={from}
      to={to}
      ourName={entity.name}
      ourEdrpou={entity.edrpou}
      ourDirector={entity.director_name}
      ourDirectorPosition={entity.director_position}
      theirName={supplier.name}
      theirEdrpou={supplier.edrpou}
      positiveMeans={`заборгованість на користь ${entity.name}`}
      negativeMeans={`заборгованість на користь ${supplier.name}`}
      backHref={`/purchasing/suppliers/${supplierId}`}
      periodFormAction={`/purchasing/suppliers/${supplierId}/reconciliation`}
    />
  );
}
