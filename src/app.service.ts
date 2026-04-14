import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getHealthcheck(): string {
    const version = process.env.VERSION || 'unknown'
    const hostname = process.env.HIDDEN_SERVICE_HOSTNAME || 'unknown'
    const publicKeyBase64 = process.env.HIDDEN_SERVICE_PUBLIC_KEY
    const publicKey = publicKeyBase64
      ? Buffer.from(publicKeyBase64, 'base64').toString('hex').toUpperCase()
      : 'unknown'
    return `Anyone DNS Service version ${version}\nHostname: ${hostname}\nPublic Key: ${publicKey}`
  }
}
