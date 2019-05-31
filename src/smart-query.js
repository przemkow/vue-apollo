import SmartApollo from './smart-apollo'
import { VUE_APOLLO_QUERY_KEYWORDS } from '../lib/consts'

export default class SmartQuery extends SmartApollo {
  type = 'query'
  vueApolloSpecialKeys = VUE_APOLLO_QUERY_KEYWORDS

  constructor (vm, key, options, autostart = true) {
    // Simple query
    if (!options.query) {
      const query = options
      options = {
        query,
      }
    }

    // Add reactive data related to the query
    if (vm.$data.$apolloData && !vm.$data.$apolloData.queries[key]) {
      vm.$set(vm.$data.$apolloData.queries, key, {
        loading: false,
      })
    }

    super(vm, key, options, false)

    if (vm.$isServer) {
      this.firstRun = new Promise((resolve, reject) => {
        this._firstRunResolve = resolve
        this._firstRunReject = reject
      })
    }

    if (this.vm.$isServer) {
      this.options.fetchPolicy = 'network-only'
    }

    if (!options.manual) {
      this.hasDataField = this.vm.$data.hasOwnProperty(key)
      if (this.hasDataField) {
        Object.defineProperty(this.vm.$data.$apolloData.data, key, {
          get: () => this.vm.$data[key],
          enumerable: true,
          configurable: true,
        })
      } else {
        Object.defineProperty(this.vm.$data, key, {
          get: () => this.vm.$data.$apolloData.data[key],
          enumerable: true,
          configurable: true,
        })
      }
    }

    if (autostart) {
      this.autostart()
    }
  }

  get client () {
    return this.vm.$apollo.getClient(this.options)
  }

  get loading () {
    return this.vm.$data.$apolloData.queries[this.key].loading;
  }

  set loading (value) {
    this.vm.$data.$apolloData.queries[this.key].loading = value
    this.vm.$data.$apolloData.loading += value ? 1 : -1
  }

  stop () {
    super.stop()
    this.loading = false;
    if (this.observer) {
      this.observer.stopPolling()
      this.observer = null
    }
  }

  executeApollo (variables) {
    const variablesJson = JSON.stringify(variables)

    if (this.sub) {
      if (variablesJson === this.previousVariablesJson) {
        return
      }
      this.sub.unsubscribe()
    }

    this.previousVariablesJson = variablesJson

    // Create observer
    this.observer = this.vm.$apollo.watchQuery(this.generateApolloOptions(variables))

    this.startQuerySubscription()

    // TODO test optimistic UI updates.
    // if (this.options.fetchPolicy !== 'no-cache') {
      const currentResult = this.observer.currentResult()
      this.nextResult(currentResult)
    // }

    super.executeApollo(variables)
  }

  startQuerySubscription () {
    if (this.sub && !this.sub.closed) return

    // Create subscription
    this.sub = this.observer.subscribe({
      next: this.nextResult.bind(this),
      error: this.catchError.bind(this),
    })
  }

  nextResult (result) {
    super.nextResult(result)

    const { data, loading, error } = result

    this.vm.$data.$apolloData.queries[this.key].loading = loading;

    if (error) {
      this.firstRunReject()
    }

    if (!loading) {
      this.firstRunResolve()
    }

    const hasResultCallback = typeof this.options.result === 'function'

    if (typeof data === 'undefined') {
      // No result
    } else if (!this.options.manual) {
      if (typeof this.options.update === 'function') {
        this.setData(this.options.update.call(this.vm, data))
      } else if (typeof data[this.key] === 'undefined' && Object.keys(data).length) {
        console.error(`Missing ${this.key} attribute on result`, data)
      } else {
        this.setData(data[this.key])
      }
    } else if (!hasResultCallback) {
      console.error(`${this.key} query must have a 'result' hook in manual mode`)
    }

    if (hasResultCallback) {
      this.options.result.call(this.vm, result, this.key)
    }
  }

  setData (value) {
    this.vm.$set(this.hasDataField ? this.vm.$data : this.vm.$data.$apolloData.data, this.key, value)
  }

  catchError (error) {
    super.catchError(error)
    this.firstRunReject()
    this.nextResult(this.observer.currentResult())
    // The observable closes the sub if an error occurs
    this.resubscribeToQuery()
  }

  resubscribeToQuery () {
    const lastError = this.observer.getLastError()
    const lastResult = this.observer.getLastResult()
    this.observer.resetLastResults()
    this.startQuerySubscription()
    Object.assign(this.observer, { lastError, lastResult })
  }

  fetchMore (...args) {
    if (this.observer) {
      return this.observer.fetchMore(...args)
    }
  }

  subscribeToMore (...args) {
    if (this.observer) {
      return {
        unsubscribe: this.observer.subscribeToMore(...args),
      }
    }
  }

  refetch (variables) {
    if (variables) {
      this.options.variables = variables
    }
    if (this.observer) {
      return this.observer.refetch(variables)
    }
  }

  setVariables (variables, tryFetch) {
    this.options.variables = variables
    if (this.observer) {
      return this.observer.setVariables(variables, tryFetch)
    }
  }

  setOptions (options) {
    Object.assign(this.options, options)
    if (this.observer) {
      return this.observer.setOptions(options)
    }
  }

  startPolling (...args) {
    if (this.observer) {
      return this.observer.startPolling(...args)
    }
  }

  stopPolling (...args) {
    if (this.observer) {
      return this.observer.stopPolling(...args)
    }
  }

  firstRunResolve () {
    if (this._firstRunResolve) {
      this._firstRunResolve()
      this._firstRunResolve = null
    }
  }

  firstRunReject (error) {
    if (this._firstRunReject) {
      this._firstRunReject(error)
      this._firstRunReject = null
    }
  }

  destroy () {
    super.destroy()

    if (this.loading) {
      this.watchLoading(false, -1)
    }
    this.loading = false
  }
}
