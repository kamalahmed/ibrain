import { DOMAINS, type CognitiveDomain } from "@/lib/games";

type Props = {
  domain: CognitiveDomain;
  className?: string;
};

/** Small gradient pill naming the cognitive area a game trains. */
export function DomainBadge({ domain, className = "" }: Props) {
  const d = DOMAINS[domain];
  return (
    <span
      className={
        `inline-flex items-center rounded-full bg-gradient-to-r ${d.accent} ` +
        "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white " +
        className
      }
    >
      {d.name}
    </span>
  );
}
