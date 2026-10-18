// Tiny Cypher highlighter (no dependencies, no innerHTML).
const KEYWORDS = new Set(
  'MATCH OPTIONAL WHERE RETURN WITH AS AND OR NOT IN CREATE MERGE SET UNWIND ORDER BY DESC ASC LIMIT CALL YIELD DISTINCT CASE WHEN THEN ELSE END IS NULL FOREACH DELETE DETACH collect count sum avg abs size all any nodes relationships startNode endNode type labels allShortestPaths shortestPath toFloat keys'.split(
    ' ',
  ),
);

export function Cypher({ code, className = '' }: { code: string; className?: string }) {
  const tokens = code.split(/(\s+|[()[\]{},:.]|<-|->|-|\*|\$[A-Za-z_]+|'[^']*'|"[^"]*"|:[A-Z_]+[A-Za-z_]*|\|)/g).filter((t) => t !== undefined && t !== '');
  return (
    <pre
      tabIndex={0}
      aria-label="Cypher query"
      className={`overflow-x-auto rounded-xl border hairline bg-black/40 p-4 text-[12.5px] leading-[1.65] ${className}`}
    >
      <code className="mono">
        {tokens.map((t, i) => {
          if (KEYWORDS.has(t))
            return (
              <span key={i} className="text-iris">
                {t}
              </span>
            );
          if (/^\$/.test(t))
            return (
              <span key={i} className="text-amber">
                {t}
              </span>
            );
          if (/^['"]/.test(t))
            return (
              <span key={i} className="text-sage">
                {t}
              </span>
            );
          if (/^:[A-Z]/.test(t))
            return (
              <span key={i} className="text-vermilion-2">
                {t}
              </span>
            );
          if (/^[A-Z][A-Za-z]+$/.test(t))
            return (
              <span key={i} className="text-sky">
                {t}
              </span>
            );
          if (/^\d+(\.\d+)?$/.test(t))
            return (
              <span key={i} className="text-amber">
                {t}
              </span>
            );
          return (
            <span key={i} className="text-bone-2">
              {t}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
