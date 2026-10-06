import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";

export type HtmlNode = DefaultTreeAdapterMap["node"];
export type HtmlElement = DefaultTreeAdapterMap["element"];
export type HtmlDocument = DefaultTreeAdapterMap["document"];
export function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}
export function children(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}
export function attribute(node: HtmlElement, name: string): string | undefined {
  return node.attrs.find((attr) => attr.name === name)?.value;
}
export function elements(node: HtmlNode, tag?: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  function walk(current: HtmlNode) {
    if (isElement(current) && (!tag || current.tagName === tag))
      found.push(current);
    for (const child of children(current)) walk(child);
  }
  walk(node);
  return found;
}
export function hidden(node: HtmlElement): boolean {
  return (
    attribute(node, "hidden") !== undefined ||
    attribute(node, "aria-hidden") === "true" ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
      attribute(node, "style") ?? "",
    )
  );
}
export function text(node: HtmlNode): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if (
    isElement(node) &&
    (hidden(node) ||
      ["script", "style", "template", "noscript", "instatic-hole"].includes(
        node.tagName,
      ))
  )
    return "";
  return children(node).map(text).join(" ");
}
export const compactText = (node: HtmlNode): string =>
  text(node).replace(/\s+/g, " ").trim();
export function parsePage(html: string): {
  document: HtmlDocument;
  main: HtmlElement;
  head: HtmlElement;
  body: HtmlElement;
} {
  const document = parse(html);
  const body = elements(document, "body")[0]!;
  const head = elements(document, "head")[0]!;
  const main =
    elements(body, "main")[0] ?? elements(body, "article")[0] ?? body;
  return { document, main, head, body };
}
export function meta(document: HtmlNode, name: string): string | undefined {
  return elements(document, "meta")
    .find(
      (node) =>
        attribute(node, "name")?.toLowerCase() === name.toLowerCase() ||
        attribute(node, "property")?.toLowerCase() === name.toLowerCase(),
    )
    ?.attrs.find((attr) => attr.name === "content")?.value;
}
export function safeUrl(raw: string, base: string): string | null {
  if (!raw.trim()) return null;
  try {
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]<>|])/g, "\\$1");
}
function inline(node: HtmlNode, base: string): string {
  if (node.nodeName === "#text" && "value" in node)
    return escapeMarkdown(node.value.replace(/\s+/g, " "));
  if (!isElement(node) || hidden(node)) return "";
  const content = children(node)
    .map((child) => inline(child, base))
    .join("");
  const tag = node.tagName;
  if (
    [
      "script",
      "style",
      "template",
      "noscript",
      "form",
      "button",
      "input",
      "instatic-hole",
    ].includes(tag)
  )
    return "";
  if (tag === "br") return "  \n";
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `*${content}*`;
  if (tag === "del") return `~~${content}~~`;
  if (tag === "code") {
    const raw = compactText(node);
    const ticks = "`".repeat(
      Math.max(
        1,
        ...[...raw.matchAll(/`+/g)].map((match) => match[0].length + 1),
      ),
    );
    return `${ticks} ${raw} ${ticks}`;
  }
  if (tag === "a") {
    const href = safeUrl(attribute(node, "href") ?? "", base);
    return href
      ? `[${content || escapeMarkdown(href)}](<${href.replace(/>/g, "%3E")}>)`
      : content;
  }
  if (tag === "img") {
    const src = safeUrl(attribute(node, "src") ?? "", base);
    return src
      ? `![${escapeMarkdown(attribute(node, "alt") ?? "")}](<${src.replace(/>/g, "%3E")}>)`
      : "";
  }
  return content;
}
export function markdown(main: HtmlNode, base: string): string {
  function block(node: HtmlNode, depth = 0): string {
    if (!isElement(node)) return inline(node, base);
    if (
      hidden(node) ||
      [
        "script",
        "style",
        "template",
        "noscript",
        "nav",
        "header",
        "footer",
        "form",
        "button",
        "input",
        "instatic-hole",
      ].includes(node.tagName)
    )
      return "";
    const tag = node.tagName;
    if (/^h[1-6]$/.test(tag))
      return `\n\n${"#".repeat(Number(tag[1]))} ${inline(node, base).trim()}\n\n`;
    if (tag === "pre") {
      const code = elements(node, "code")[0];
      const value = text(code ?? node).trim();
      const fence = "`".repeat(
        Math.max(
          3,
          ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1),
        ),
      );
      const language =
        (code && attribute(code, "class")?.match(/language-([\w+-]+)/)?.[1]) ??
        "";
      return `\n\n${fence}${language}\n${value}\n${fence}\n\n`;
    }
    if (tag === "table") {
      const rows = elements(node, "tr").map((row) =>
        children(row)
          .filter(isElement)
          .filter((cell) => ["th", "td"].includes(cell.tagName))
          .map((cell) => inline(cell, base).replace(/\n/g, "<br>").trim()),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) =>
        "| " +
        Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ") +
        " |";
      return (
        "\n\n" +
        [
          line(rows[0]!),
          line(Array(width).fill("---")),
          ...rows.slice(1).map(line),
        ].join("\n") +
        "\n\n"
      );
    }
    if (tag === "ul" || tag === "ol") {
      const start = Number(attribute(node, "start") ?? 1);
      return (
        "\n" +
        children(node)
          .filter(isElement)
          .filter((item) => item.tagName === "li")
          .map((item, i) => {
            const prefix = tag === "ol" ? `${start + i}. ` : "- ";
            const value = children(item)
              .map((child) => block(child, depth + 1))
              .join("")
              .trim();
            return (
              "  ".repeat(depth) +
              prefix +
              value.replace(
                /\n/g,
                "\n" + "  ".repeat(depth) + " ".repeat(prefix.length),
              )
            );
          })
          .join("\n") +
        "\n\n"
      );
    }
    if (tag === "blockquote")
      return (
        "\n\n" +
        children(node)
          .map((child) => block(child, depth))
          .join("")
          .trim()
          .split("\n")
          .map((line) => "> " + line)
          .join("\n") +
        "\n\n"
      );
    if (tag === "hr") return "\n\n---\n\n";
    if (["p", "figure", "figcaption"].includes(tag))
      return (
        "\n\n" +
        children(node)
          .map((child) => block(child, depth))
          .join("")
          .trim() +
        "\n\n"
      );
    if (["div", "main", "article", "section", "body", "aside"].includes(tag))
      return children(node)
        .map((child) => block(child, depth))
        .join("");
    return inline(node, base);
  }
  return (
    block(main)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
export function remove(node: HtmlElement): void {
  const parent = node.parentNode;
  if (parent)
    parent.childNodes = parent.childNodes.filter((child) => child !== node);
}
export function append(head: HtmlElement, markup: string): void {
  const parsed = parse(markup);
  const nodes = elements(parsed, "head")[0]!.childNodes;
  for (const node of nodes) {
    node.parentNode = head;
    head.childNodes.push(node);
  }
}
export function serializePage(document: HtmlDocument): string {
  return serialize(document);
}
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
