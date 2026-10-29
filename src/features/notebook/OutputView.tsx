import { useLayoutEffect, useMemo, useRef } from "react";
import Anser from "anser";
import { tx } from "@/platform/i18n";
import { editorService, notifications } from "@/workbench/contributions";
import { resolveLink } from "@/features/viewers/markdown/render";
import { imageMimeUrl, markdownFragment, staticOutputDocument } from "./security";
import { mimeText, object } from "./outputs";
import styles from "./Notebook.module.css";

const PREVIEW_LIMIT = 200_000;
function AnsiText({ text, error = false }: { text: string; error?: boolean }) {
  const entries = useMemo(() => Anser.ansiToJson(text.slice(0, PREVIEW_LIMIT), { json: true }), [text]);
  return (
    <>
      <pre className={error ? styles.errorOutput : styles.textOutput}>
        {entries.map((entry, index) => (
          <span
            key={index}
            style={{
              color: entry.fg ? `rgb(${entry.fg})` : undefined,
              backgroundColor: entry.bg ? `rgb(${entry.bg})` : undefined,
              fontWeight: entry.decorations?.includes("bold") ? 700 : undefined,
              fontStyle: entry.decorations?.includes("italic") ? "italic" : undefined,
              textDecoration: entry.decorations?.includes("underline") ? "underline" : undefined,
            }}
          >
            {entry.content}
          </span>
        ))}
      </pre>
      {text.length > PREVIEW_LIMIT && (
        <p className={styles.notice}>{tx("Output preview truncated; full output is retained in the notebook.")}</p>
      )}
    </>
  );
}

function StaticHtml({ html, title }: { html: string; title: string }) {
  const srcDoc = useMemo(() => staticOutputDocument(html), [html]);
  return (
    <iframe className={styles.outputFrame} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} title={title} />
  );
}

function MimeBundle({ value }: { value: unknown }) {
  const bundle = object(value);
  const image = useMemo(() => imageMimeUrl(bundle), [bundle]);
  const html = mimeText(bundle["text/html"]);
  const plain = mimeText(bundle["text/plain"]);
  const javascript = mimeText(bundle["application/javascript"]) || mimeText(bundle["text/javascript"]);
  const supported = image || html || plain;
  return (
    <>
      {image ? (
        <img className={styles.outputImage} src={image} alt={plain || tx("Notebook image output")} loading="lazy" />
      ) : html ? (
        <StaticHtml html={html} title={tx("Static notebook HTML output")} />
      ) : plain ? (
        <AnsiText text={plain} />
      ) : null}
      {javascript && (
        <>
          <p className={styles.notice}>{tx("JavaScript output is inert. Interactive widgets are not supported.")}</p>
          <StaticHtml
            title={tx("Inert JavaScript source")}
            html={`<pre>${javascript.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`}
          />
        </>
      )}
      {!supported && !javascript && (
        <p className={styles.notice}>
          {tx("Unsupported output MIME type; original data is preserved.")} {Object.keys(bundle).join(", ")}
        </p>
      )}
    </>
  );
}

export function CellOutputs({ outputs }: { outputs: unknown[] }) {
  if (!outputs.length) return null;
  return (
    <div className={styles.outputs} aria-label={tx("Cell outputs")}>
      {outputs.map((value, index) => {
        const output = object(value);
        switch (output.output_type) {
          case "stream":
            return <AnsiText key={index} text={mimeText(output.text)} error={output.name === "stderr"} />;
          case "error":
            return (
              <AnsiText
                key={index}
                error
                text={
                  Array.isArray(output.traceback)
                    ? output.traceback.map(mimeText).join("\n")
                    : `${mimeText(output.ename)}: ${mimeText(output.evalue)}`
                }
              />
            );
          case "display_data":
          case "execute_result":
            return <MimeBundle key={index} value={output.data} />;
          default:
            return (
              <p key={index} className={styles.notice}>
                {tx("Unsupported output type; original data is preserved.")} {String(output.output_type ?? "unknown")}
              </p>
            );
        }
      })}
    </div>
  );
}

export function MarkdownCell({ source, attachments, path }: { source: string; attachments: unknown; path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fragment = markdownFragment(source, attachments);
    root.replaceChildren(...fragment.childNodes);
    return () => root.replaceChildren();
  }, [source, attachments]);
  const openLink = (target: Element) => {
    const linkElement = target.closest("a[data-notebook-href]");
    if (!linkElement) return;
    try {
      const link = resolveLink(path, linkElement.getAttribute("data-notebook-href") ?? "");
      if (link?.kind === "file")
        void editorService()
          .openFile(link.path, {
            focus: true,
            ...(link.line !== undefined ? { selection: { line: link.line, col: 0 } } : {}),
          })
          .catch((error) => notifications().notify({ level: "error", title: String(error) }));
    } catch {
      /* Malformed notebook URLs are inert. */
    }
  };
  return (
    <div
      ref={ref}
      className={styles.markdown}
      onClick={(event) => {
        event.preventDefault();
        openLink(event.target as Element);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (!(event.target as Element).closest("a[data-notebook-href]")) return;
          event.preventDefault();
          event.stopPropagation();
          openLink(event.target as Element);
        }
      }}
    />
  );
}
