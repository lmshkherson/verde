import { updateLeadStatus } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const statuses: Record<string, string> = {
  new: "Нова",
  in_progress: "В роботі",
  done: "Оброблена",
  spam: "Спам",
};

const types: Record<string, string> = {
  individual: "Індивідуальне пошиття",
  callback: "Зворотний дзвінок",
  question: "Питання",
};

export default async function AdminLeadsPage() {
  const leads = await prisma.lead.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Заявки</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Заявки на індивідуальне пошиття та зворотні дзвінки. Нові — зверху.
        </p>
      </div>

      {leads.length === 0 ? (
        <p className="rounded-[4px] border border-line bg-white p-6 text-sm text-ink-muted">
          Заявок поки немає.
        </p>
      ) : (
        <div className="flex flex-col gap-px overflow-hidden rounded-[4px] border border-line bg-line">
          {leads.map((lead) => (
            <article key={lead.id} className="bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {lead.name}
                    <span className="tabular ml-2 font-normal text-ink-muted">
                      <a href={`tel:${lead.phone}`} className="hover:underline">
                        {lead.phone}
                      </a>
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {types[lead.type] ?? lead.type} · {formatDateTime(lead.createdAt)}
                  </p>
                </div>

                <form action={updateLeadStatus} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={lead.id} />
                  <select
                    name="status"
                    defaultValue={lead.status}
                    className="h-9 rounded-[4px] border border-line px-2 text-sm outline-none focus:border-ink"
                  >
                    {Object.entries(statuses).map(([slug, label]) => (
                      <option key={slug} value={slug}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="h-9 rounded-[4px] border border-line px-3 text-sm font-semibold hover:border-ink"
                  >
                    Зберегти
                  </button>
                </form>
              </div>

              {lead.carLabel ? (
                <p className="mt-3 text-sm">
                  <span className="text-ink-muted">Авто: </span>
                  {lead.carLabel}
                </p>
              ) : null}
              {lead.message ? (
                <p className="mt-1 text-sm text-ink-muted">{lead.message}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
