/**
 * File import for the AI chat: what leaves the browser is *text*, because the
 * chat API carries text messages only.
 *
 *  - text documents (.txt .md .csv .json .log .yaml .xml source files…) are read
 *    directly, capped so a message never exceeds the API's 16 000-char limit;
 *  - PDFs are lazily parsed with pdf.js (Mozilla), loaded only when a PDF is
 *    actually attached — the engine chunk is never in the critical path;
 *  - anything else (images, office binaries) is refused with an explicit
 *    reason: the honest answer is "not supported yet", never a silent nothing.
 */

export interface Attachment {
  name: string;
  size: number;
  kind: "text" | "pdf";
  text: string;
}

export class AttachmentError extends Error {
  constructor(
    readonly title: string,
    readonly detail: string
  ) {
    super(title);
    this.name = "AttachmentError";
  }
}

/** Extraction budget per file, in characters, and for the whole message. */
export const MAX_PER_FILE = 10_000;
export const MAX_TOTAL = 14_000;

const TEXT_PATTERN =
  /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|toml|ini|xml|html?|svg|css|scss|jsx?|tsx?|py|rb|go|rs|java|c|h|cpp|sh|sql|env|gitignore)$/i;

/** The chat message limit on the API is 16 000 chars; attachments leave room. */
const API_MESSAGE_LIMIT = 16_000;

function truncate(text: string, label: string): string {
  if (text.length <= MAX_PER_FILE) return text;
  return `${text.slice(0, MAX_PER_FILE)}\n\n[… texte tronqué (${label}) — ${text.length} caractères au total]`;
}

async function extractPdf(file: File): Promise<string> {
  // Lazy: pdf.js (engine + worker, ~1 MB in chunks) is only fetched when a
  // real PDF lands in the composer.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageLimit = Math.min(doc.numPages, 40);
  const parts: string[] = [];
  let budget = MAX_PER_FILE;
  for (let page = 1; page <= pageLimit; page += 1) {
    const content = await doc.getPage(page).then((p) => p.getTextContent());
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (budget <= 0) break;
    const slice = text.slice(0, budget);
    budget -= slice.length;
    parts.push(`[page ${page}]\n${slice}`);
  }
  const notes: string[] = [];
  if (doc.numPages > pageLimit) {
    notes.push(`document tronqué : ${pageLimit}/${doc.numPages} pages analysées`);
  }
  const body = parts.join("\n\n");
  if (!body.trim()) {
    throw new AttachmentError(
      "PDF sans texte extractible",
      "Ce PDF ne contient pas de couche texte (scan ?). Il faut un PDF textuel pour l'import."
    );
  }
  return notes.length ? `${body}\n\n[${notes.join(" ; ")}]` : body;
}

/** Extracts the textual payload of `file`, or throws an AttachmentError. */
export async function extractAttachment(file: File): Promise<Attachment> {
  if (file.size > 20 * 1024 * 1024) {
    throw new AttachmentError(
      file.name,
      "Fichier trop volumineux (max 20 Mo) pour une extraction locale."
    );
  }
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file.name)) {
    throw new AttachmentError(
      file.name,
      "Les images ne sont pas encore transmises au modèle (API texte). Exportez la capture en PDF texte ou collez le contenu utile."
    );
  }
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    return { name: file.name, size: file.size, kind: "pdf", text: await extractPdf(file) };
  }
  if (TEXT_PATTERN.test(file.name) || file.type.startsWith("text/")) {
    const raw = await file.text();
    return {
      name: file.name,
      size: file.size,
      kind: "text",
      text: truncate(raw, "fichier texte"),
    };
  }
  throw new AttachmentError(
    file.name,
    "Type de fichier non pris en charge. Documents texte (.md, .txt, .csv, .json, code…) et PDF textuels sont importés ; les images et suites office ne le sont pas encore."
  );
}

/**
 * Composes the outgoing message: the user's text first, then each attachment as
 * a clearly-labelled context block the model can quote.
 */
export function composeMessage(draft: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return draft;
  const blocks = attachments.map(
    (attachment) =>
      `<document name="${attachment.name}" kind="${attachment.kind}">\n${attachment.text}\n</document>`
  );
  let combined = `${draft.trim()}\n\n---\nPièces jointes importées (extraction texte) :\n\n${blocks.join("\n\n")}`;
  if (combined.length > API_MESSAGE_LIMIT - 200) {
    combined = `${combined.slice(0, API_MESSAGE_LIMIT - 200)}\n\n[… ensemble tronqué pour respecter la limite de message]`;
  }
  return combined;
}

/** Short human summary for the chip row. */
export function attachmentSummary(attachment: Attachment): string {
  const pages = attachment.kind === "pdf" ? "PDF · " : "";
  const kb = Math.max(1, Math.round(attachment.size / 1024));
  return `${pages}${attachment.name} · ${kb} ko · ${attachment.text.length} car.`;
}
