// Cada operación captura el reloj una vez; producción usa la hora real.
export function nowDate(ctx = {}) {
  const value = ctx.now ? ctx.now() : Date.now();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('El reloj no devuelve una fecha válida.');
  return date;
}
