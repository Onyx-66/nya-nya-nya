function skipSubBlocks(bytes: Uint8Array, start: number) {
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset]!;
    offset += 1;
    if (length === 0) return offset;
    if (offset + length > bytes.length) return bytes.length;
    offset += length;
  }
  return offset;
}

export function gifFrameCount(bytes: Uint8Array) {
  if (
    bytes.length < 13 ||
    !["GIF87a", "GIF89a"].includes(
      String.fromCharCode(...bytes.slice(0, 6)),
    )
  ) {
    return 0;
  }

  const logicalScreenPacked = bytes[10]!;
  let offset = 13;
  if ((logicalScreenPacked & 0x80) !== 0) {
    offset += 3 * 2 ** ((logicalScreenPacked & 0x07) + 1);
  }

  let frames = 0;
  while (offset < bytes.length) {
    const introducer = bytes[offset]!;
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      if (offset + 2 > bytes.length) break;
      offset = skipSubBlocks(bytes, offset + 2);
      continue;
    }
    if (introducer === 0x2c) {
      if (offset + 10 > bytes.length) break;
      frames += 1;
      const imagePacked = bytes[offset + 9]!;
      offset += 10;
      if ((imagePacked & 0x80) !== 0) {
        offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
      }
      if (offset >= bytes.length) break;
      offset += 1;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    if (introducer === 0x00) {
      offset += 1;
      continue;
    }
    break;
  }
  return frames;
}
