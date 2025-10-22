import { DomainResolutionError } from './domain-resolution.error';

export class UnsupportedHiddenServiceTldError extends DomainResolutionError {
  constructor(tld: string, hiddenServiceAddress: string, domain: string) {
    super(
      `Hidden Service TLD .${tld} is not supported for hidden service ` +
        `address: ${hiddenServiceAddress} of domain: ${domain}`
    )
    this.name = 'UnsupportedHiddenServiceTldError'
  }
}
