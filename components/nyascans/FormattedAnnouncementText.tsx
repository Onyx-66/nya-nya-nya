import type { ReactNode } from "react";

const inlineMarkup = /(\*\*[^*\n]+\*\*|_[^_\n]+_|\[[^\]\n]+\]\((?:https:\/\/|\/(?!\/))[^)\s]+\))/g;

function inlineNodes(value: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(inlineMarkup)) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push(value.slice(offset, index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const external = link[2]!.startsWith("https://");
        nodes.push(
          <a
            key={key}
            href={link[2]}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    offset = index + token.length;
  }
  if (offset < value.length) nodes.push(value.slice(offset));
  return nodes;
}

export function FormattedAnnouncementText({ body }: { body: string }) {
  const lines = body.split(/\r?\n/);
  return (
    <p className="formatted-announcement-text">
      {lines.map((line, index) => (
        <span key={`${index}-${line.slice(0, 24)}`}>
          {inlineNodes(line, String(index))}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}
