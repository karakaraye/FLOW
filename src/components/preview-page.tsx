import { Construction, ArrowUpRight } from "lucide-react";
export function PreviewPage({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { title: string; description: string; tag: string }[];
}) {
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Product preview
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-500">
        {description}
      </p>
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Construction size={20} className="mt-0.5 shrink-0" />
        <p>
          <strong>Coming soon.</strong> This is a preview of the planned
          experience. These features are not connected or operational.
        </p>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-border bg-white p-6"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-stone-100 px-2 py-1 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
                {item.tag}
              </span>
              <ArrowUpRight
                size={17}
                className="text-stone-300"
                aria-hidden="true"
              />
            </div>
            <h2 className="mt-6 text-lg font-semibold">{item.title}</h2>
            <p className="mt-3 text-sm leading-7 text-stone-500">
              {item.description}
            </p>
            <p className="mt-6 text-xs font-medium text-stone-500">
              Planned · Not available yet
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
