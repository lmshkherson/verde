import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Замовлення прийнято",
  robots: { index: false, follow: false },
};

export default async function CheckoutSuccessPage(
  props: PageProps<"/checkout/success">,
) {
  const search = await props.searchParams;
  const orderNumber = typeof search.order === "string" ? search.order : null;

  return (
    <Container className="py-16">
      <div className="mx-auto max-w-2xl rounded-[4px] border border-line bg-white p-8 text-center sm:p-12">
        <p className="label">Дякуємо за замовлення</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">
          Замовлення прийнято
        </h1>

        {orderNumber ? (
          <p className="mt-4 text-lg">
            Номер вашого замовлення:{" "}
            <span className="tabular font-bold">{orderNumber}</span>
          </p>
        ) : null}

        <div className="mt-8 text-left">
          <h2 className="text-base font-bold">Що далі</h2>
          <ol className="mt-3 flex flex-col gap-3">
            <li className="flex gap-3">
              <span className="tabular shrink-0 font-display text-sm font-bold text-tan">
                01
              </span>
              <span className="text-sm text-ink-muted">
                Менеджер зателефонує протягом робочого дня, щоб підтвердити модель,
                рік і комплектацію авто. Це головний крок: саме тут відсіюються
                помилки з посадкою чохлів.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="tabular shrink-0 font-display text-sm font-bold text-tan">
                02
              </span>
              <span className="text-sm text-ink-muted">
                Після підтвердження замовлення йде в розкрій. Ми надішлемо фото
                матеріалу перед пошиттям.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="tabular shrink-0 font-display text-sm font-bold text-tan">
                03
              </span>
              <span className="text-sm text-ink-muted">
                У день відправлення надішлемо ТТН у месенджер і лишимось на звʼязку,
                поки чохли не стануть на місце.
              </span>
            </li>
          </ol>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 border-t border-line-soft pt-6">
          <p className="text-sm text-ink-muted">
            Питання по замовленню — телефонуйте:{" "}
            <a href={site.phones[0].href} className="font-semibold text-ink">
              {site.phones[0].label}
            </a>
          </p>
          <ButtonLink href="/" variant="ghost">
            На головну
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
