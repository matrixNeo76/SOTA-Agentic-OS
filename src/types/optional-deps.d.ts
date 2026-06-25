/**
 * Dichiarazioni di modulo per dipendenze opzionali (caricate lazy via import dinamico).
 * I pacchetti non sono installati in dev (SQLite path); vengono installati in produzione.
 */

declare module 'nats' {
  export function connect(opts: { servers: string }): Promise<NatsClient>
  export interface NatsClient {
    jetstream(): JetStreamManager
    closed(): Promise<void> | boolean
    close(): Promise<void>
    drain(): Promise<void>
  }
  export interface JetStreamManager {
    publish(subject: string, data: string): Promise<void>
    consumers: {
      get(stream: string, opts?: any): Promise<Consumer>
      add(stream: string, opts: any): Promise<Consumer>
    }
  }
  export interface Consumer {
    consume(opts: { callback: (msg: any) => Promise<void> }): Promise<Subscription>
  }
  export interface Subscription {
    drain(): Promise<void>
  }
}

declare module 'redis' {
  export function createClient(opts: { url: string }): RedisClient
  export interface RedisClient {
    connect(): Promise<void>
    xAdd(key: string, id: string, fields: Record<string, string>): Promise<string>
    xReadGroup(group: string, consumer: string, streams: Array<{ key: string; id: string }>, opts?: { COUNT?: number; BLOCK?: number }): Promise<any>
    xGroupCreate(key: string, group: string, id: string): Promise<void>
    xAck(key: string, group: string, id: string): Promise<number>
    ping(): Promise<string>
  }
}
