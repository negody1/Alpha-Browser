import net, { type Socket } from 'node:net';

export interface Socks5ServerOptions {
  host: string; // must be 127.0.0.1
  port: number; // preferred port
}

export class Socks5Server {
  private server: net.Server | null = null;
  private boundPort: number | null = null;

  constructor(private readonly options: Socks5ServerOptions) {}

  getPort(): number | null {
    return this.boundPort;
  }

  async listen(): Promise<number> {
    if (this.server) {
      return this.boundPort ?? this.options.port;
    }

    this.server = net.createServer((socket) => this.handleClient(socket));
    this.server.on('error', () => {
      // handled by listen() reject
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen({ host: this.options.host, port: this.options.port }, () => resolve());
    });

    const addr = this.server.address();
    this.boundPort = typeof addr === 'object' && addr ? addr.port : this.options.port;
    return this.boundPort;
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }
    const srv = this.server;
    this.server = null;
    this.boundPort = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private handleClient(socket: Socket): void {
    socket.setNoDelay(true);
    socket.once('error', () => {
      socket.destroy();
    });

    // SOCKS5 handshake:
    // client: VER, NMETHODS, METHODS...
    socket.once('data', (hello) => {
      if (hello.length < 3 || hello[0] !== 0x05) {
        socket.destroy();
        return;
      }

      // reply: VER=5, METHOD=0x00 (no auth)
      socket.write(Buffer.from([0x05, 0x00]));

      socket.once('data', (req) => this.handleRequest(socket, req));
    });
  }

  private handleRequest(client: Socket, req: Buffer): void {
    // request: VER, CMD, RSV, ATYP, DST.ADDR..., DST.PORT(2)
    if (req.length < 7 || req[0] !== 0x05) {
      client.destroy();
      return;
    }

    const cmd = req[1];
    const atyp = req[3];

    if (cmd !== 0x01) {
      // command not supported
      this.replyFail(client, 0x07);
      return;
    }

    let offset = 4;
    let host = '';

    if (atyp === 0x01) {
      // IPv4
      if (req.length < offset + 4 + 2) {
        client.destroy();
        return;
      }
      host = `${req[offset]}.${req[offset + 1]}.${req[offset + 2]}.${req[offset + 3]}`;
      offset += 4;
    } else if (atyp === 0x03) {
      // DOMAIN
      const len = req[offset];
      offset += 1;
      if (req.length < offset + len + 2) {
        client.destroy();
        return;
      }
      host = req.subarray(offset, offset + len).toString('utf8');
      offset += len;
    } else {
      // ATYP not supported (IPv6 etc.)
      this.replyFail(client, 0x08);
      return;
    }

    const port = req.readUInt16BE(offset);

    const upstream = net.createConnection({ host, port, timeout: 8000 }, () => {
      // success reply: VER=5, REP=0, RSV=0, ATYP=1, BND.ADDR=0.0.0.0, BND.PORT=0
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      client.pipe(upstream);
      upstream.pipe(client);
    });

    upstream.on('error', () => {
      this.replyFail(client, 0x05);
    });
    upstream.setTimeout(8000, () => {
      upstream.destroy();
      this.replyFail(client, 0x05);
    });

    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  }

  private replyFail(client: Socket, rep: number): void {
    try {
      client.write(Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    } finally {
      client.destroy();
    }
  }
}

