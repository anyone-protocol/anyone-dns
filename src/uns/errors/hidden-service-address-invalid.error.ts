import { DomainResolutionError } from './domain-resolution.error';

export class HiddenServiceAddressInvalidError extends DomainResolutionError {
  constructor(hiddenServiceAddress: string, domain: string) {
    super(
      `Invalid hidden service address checksum for address: ` +
        `${hiddenServiceAddress} of domain: ${domain}`
    )
    this.name = 'HiddenServiceAddressInvalidError'
  }
}
