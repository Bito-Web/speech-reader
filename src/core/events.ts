/**
 * Emisor de eventos tipado y sin dependencias.
 *
 * Se usa para desacoplar la clase `Reader` de los callbacks concretos y para
 * permitir varios listeners (y su baja) sin duplicar lógica de suscripción.
 */

export type EventListener<T> = (payload: T) => void;

type AnyListener = (payload: unknown) => void;

export class EventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<AnyListener>>();

  /**
   * Suscribe un listener. Devuelve una función para darse de baja.
   */
  public on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set<AnyListener>();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener as unknown as AnyListener);

    return () => {
      this.off(event, listener);
    };
  }

  public off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;

    bucket.delete(listener as unknown as AnyListener);
    if (bucket.size === 0) this.listeners.delete(event);
  }

  public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;

    // Copia para permitir que un listener se dé de baja durante la emisión.
    for (const listener of [...bucket]) {
      try {
        (listener as unknown as EventListener<Events[K]>)(payload);
      } catch (error) {
        // Un callback del usuario no debe romper la reproducción.
        console.error('[Reader] Un listener lanzó un error:', error);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
