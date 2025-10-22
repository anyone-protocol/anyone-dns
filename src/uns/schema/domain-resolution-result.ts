import { DomainResolutionError } from '../errors/domain-resolution.error'

export type DomainResolutionResult = {
  result: 'success'
  domain: string
  hiddenServiceAddress: string
} | {
  result: 'error'
  domain: string
  error: DomainResolutionError
}
