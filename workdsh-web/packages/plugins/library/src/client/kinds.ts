import type { LibraryAssetKind } from 'workdsh-contracts/library';

export const kindIcons: Readonly<Record<LibraryAssetKind, string>> = {
  markdown: 'M', text: 'T', html: '</>', pdf: 'PDF', docx: 'W', doc: 'W', odt: 'W', rtf: 'W', pptx: 'P', ppt: 'P', odp: 'P',
  xlsx: 'X', xls: 'X', ods: 'X', csv: 'X', epub: 'E', image: '🖼',
};
export const typeNames: Readonly<Record<LibraryAssetKind, string>> = {
  markdown: 'Markdown', text: 'TXT', html: 'HTML', pdf: 'PDF', docx: 'Word', doc: 'Word 97–2003', odt: 'ODT', rtf: 'RTF',
  pptx: 'PowerPoint', ppt: 'PowerPoint 97–2003', odp: 'ODP', xlsx: 'Excel', xls: 'Excel 97–2003', ods: 'ODS', csv: 'CSV', epub: 'EPUB', image: '图片',
};
/** Upload filter: everything the Host converts, including OCR for pictures. */
export const LIBRARY_ACCEPT = '.md,.markdown,.txt,.html,.htm,.pdf,.docx,.doc,.odt,.rtf,.pptx,.ppt,.odp,.xlsx,.xlsm,.xls,.ods,.csv,.epub,.png,.jpg,.jpeg,.bmp,.gif,.webp,.tif,.tiff';
/** Kinds whose converted text is Markdown produced by AnyDoc or OCR. */
export const markdownKinds: ReadonlySet<LibraryAssetKind> = new Set(['markdown', 'doc', 'xls', 'xlsx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'epub', 'csv', 'image']);
