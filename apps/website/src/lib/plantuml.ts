import { deflateSync, strToU8 } from "fflate";

function encodePlantUmlValue(value: number) {
  if (value < 10) {
    return String.fromCharCode(48 + value);
  }

  if (value < 36) {
    return String.fromCharCode(55 + value);
  }

  if (value < 62) {
    return String.fromCharCode(61 + value);
  }

  if (value === 62) {
    return "-";
  }

  if (value === 63) {
    return "_";
  }

  return "?";
}

function appendPlantUmlBytes(byte1: number, byte2: number, byte3: number) {
  const first = byte1 >> 2;
  const second = ((byte1 & 0x3) << 4) | (byte2 >> 4);
  const third = ((byte2 & 0xf) << 2) | (byte3 >> 6);
  const fourth = byte3 & 0x3f;

  return [
    encodePlantUmlValue(first & 0x3f),
    encodePlantUmlValue(second & 0x3f),
    encodePlantUmlValue(third & 0x3f),
    encodePlantUmlValue(fourth & 0x3f),
  ].join("");
}

export function buildPlantUmlUrl(code: string) {
  const compressed = deflateSync(strToU8(code), { level: 9 });
  let encoded = "";

  for (let index = 0; index < compressed.length; index += 3) {
    encoded += appendPlantUmlBytes(
      compressed[index] ?? 0,
      compressed[index + 1] ?? 0,
      compressed[index + 2] ?? 0,
    );
  }

  return `https://www.plantuml.com/plantuml/svg/${encoded}`;
}
