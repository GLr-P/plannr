// pdf.js's worker module, loaded into the page for the print preview (components/PrintPreview.tsx)
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown
}
