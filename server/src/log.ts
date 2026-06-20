// log.ts - minimal timestamped logger with named scopes.
type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  const tag = `${ts} [${scope}]`;
  if (level === "error") console.error(tag, ...args);
  else if (level === "warn") console.warn(tag, ...args);
  else console.log(tag, ...args);
}

export function logger(scope: string) {
  return {
    info: (...a: unknown[]) => emit("info", scope, a),
    warn: (...a: unknown[]) => emit("warn", scope, a),
    error: (...a: unknown[]) => emit("error", scope, a),
  };
}
