const MARK = 560;
const HEADER_MARK = 9000;
const HEADER_SPACE = 4500;
const REPEAT_SPACE = 2250;
const ONE_SPACE = 1690;

export function encodeNec(address: number, command: number): number[] {
  assertByte(address, 'address');
  assertByte(command, 'command');
  const timings = [HEADER_MARK, HEADER_SPACE];
  pushByte(timings, address);
  pushByte(timings, ~address & 0xff);
  pushByte(timings, command);
  pushByte(timings, ~command & 0xff);
  timings.push(MARK);
  return timings;
}

export function encodeNecRepeat(): number[] {
  return [HEADER_MARK, REPEAT_SPACE, MARK];
}

function pushByte(timings: number[], value: number): void {
  for (let bit = 0; bit < 8; bit += 1) {
    timings.push(MARK, (value >> bit) & 1 ? ONE_SPACE : MARK);
  }
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`NEC ${name} must be an integer from 0 to 255.`);
  }
}
