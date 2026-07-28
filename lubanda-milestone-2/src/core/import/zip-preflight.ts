export interface ZipEntryMetadata {
  readonly path: string;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
}

export interface ZipPreflightResult {
  readonly entries: readonly ZipEntryMetadata[];
  readonly totalUncompressedBytes: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

const findEndOfCentralDirectory = (view: DataView): number => {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new TypeError("Invalid ZIP: end-of-central-directory record not found");
};

export const inspectZipDirectory = (input: ArrayBuffer): ZipPreflightResult => {
  const view = new DataView(input);
  if (view.byteLength < 22) throw new TypeError("Invalid ZIP: file is too small");
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntryMetadata[] = [];
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new TypeError("Invalid ZIP: malformed central directory");
    }
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) {
      throw new TypeError("Invalid ZIP: truncated central-directory filename");
    }
    const path = decoder.decode(new Uint8Array(input, nameStart, nameLength));
    entries.push({ path, compressedBytes, uncompressedBytes });
    totalUncompressedBytes += uncompressedBytes;
    offset = nameEnd + extraLength + commentLength;
  }

  return { entries, totalUncompressedBytes };
};

