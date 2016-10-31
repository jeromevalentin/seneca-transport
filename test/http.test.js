'use strict'

var Assert = require('assert')
var Code = require('code')
var Lab = require('lab')
var Http = require('../lib/http')
var TransportUtil = require('../lib/transport-utils')
var Wreck = require('wreck')

var CreateInstance = require('./utils/createInstance')
var CreateClient = require('./utils/createClient')

var lab = exports.lab = Lab.script()
var describe = lab.describe
var it = lab.it
var expect = Code.expect

describe('Specific http', function () {
  it('web-basic', function (done) {
    CreateInstance()
      .add('c:1', function (args, cb) {
        cb(null, {s: '1-' + args.d})
      })
      .listen({type: 'web', port: 20202})
      .ready(function () {
        var count = 0
        function check () {
          count++
          if (count === 4) {
            done()
          }
        }

        CreateClient('http', 20202, check)
        CreateClient('http', 20202, check)
        CreateClient('http', 20202, check)

        var requestOptions = {
          payload: JSON.stringify({ c: 1, d: 'A' }),
          json: true
        }
        // special case for non-seneca clients
        Wreck.post(
          'http://localhost:20202/act',
          requestOptions,
          function (err, res, body) {
            if (err) {
              return done(err)
            }
            Assert.equal('{"s":"1-A"}', JSON.stringify(body))
            check()
          })
      })
  })

  it('error-passing-http', function (fin) {
    CreateInstance()
      .add('a:1', function (args, done) {
        done(new Error('bad-wire'))
      })
      .listen(30303)

    CreateInstance()
      .client(30303)
      .act('a:1', function (err, out) {
        Assert.equal('seneca: Action a:1 failed: bad-wire.', err.message)
        fin()
      })
  })

  it('http-query', function (fin) {
    CreateInstance({errhandler: fin})
      .add('a:1', function (args, done) {
        done(null, this.util.clean(args))
      })
      .listen({type: 'web', port: 20302})
      .ready(function () {
        Wreck.get(
          'http://localhost:20302/act?a=1&b=2', { json: true },
          function (err, res, body) {
            if (err) {
              return fin(err)
            }
            Assert.equal(1, body.a)
            Assert.equal(2, body.b)

            Wreck.get(
              'http://localhost:20302/act?args$=a:1, b:2, c:{d:3}', { json: true },
              function (err, res, body) {
                if (err) {
                  return fin(err)
                }
                Assert.equal(1, body.a)
                Assert.equal(2, body.b)
                Assert.equal(3, body.c.d)

                fin()
              }
           )
          }
       )
      }
   )
  })

  it('web-add-headers', function (fin) {
    CreateInstance({errhandler: fin})
      .add('c:1', function (args, done) {
        done(null, {s: '1-' + args.d})
      })
      .listen({type: 'web', port: 20205})
      .ready(function () {
        CreateInstance({errhandler: fin}, {web: {headers: {'client-id': 'test-client'}}})
          .client({ type: 'web', port: 20205 })
          .ready(function () {
            this.act('c:1,d:A', function (err, out) {
              if (err) {
                return fin(err)
              }

              Assert.equal('{"s":"1-A"}', JSON.stringify(out))

              this.act('c:1,d:AA', function (err, out) {
                if (err) {
                  return fin(err)
                }

                Assert.equal('{"s":"1-AA"}', JSON.stringify(out))

                this.close(fin)
              })
            })
          })
      })
  })

  it('can listen on ephemeral port', function (done) {
    var seneca = CreateInstance()
    var settings = {
      web: {
        port: 0
      }
    }

    var callmap = {}

    var transportUtil = new TransportUtil({
      callmap: callmap,
      seneca: seneca,
      options: settings
    })

    var http = Http.listen(settings, transportUtil)
    expect(typeof http).to.equal('function')

    http.call(seneca, { type: 'web' }, function (err) {
      expect(err).to.not.exist()
      done()
    })
  })

  it('defaults to 127.0.0.1 for connections', function (done) {
    var seneca = CreateInstance()

    var settings = {
      web: {
        port: 0
      }
    }

    var callmap = {}

    var transportUtil = new TransportUtil({
      callmap: callmap,
      seneca: seneca,
      options: settings
    })

    var server = Http.listen(settings, transportUtil)
    expect(typeof server).to.equal('function')

    server.call(seneca, { type: 'web' }, function (err, address) {
      expect(err).to.not.exist()

      expect(address.type).to.equal('web')
      settings.web.port = address.port
      var client = Http.client(settings, transportUtil)
      expect(typeof client).to.equal('function')
      client.call(seneca, { type: 'web' }, function (err) {
        expect(err).to.not.exist()
        done()
      })
    })
  })

  it('apply inward/outward listen options on HTTP remote act call', function (fin) {
    CreateInstance()
      .add('foo:1', function (args, done) {
        done(null, { BAR: args.bar })
      })
      .listen({type: 'http', port: '18997',
        inward: (context, data) => {
          data.msg.bar += 1
          data.msg.inward = 'INPUT UPGRADED'
        },
        outward: (context, data) => {
          data.res.BAR += 10
          data.res.inward = data.msg.inward
          data.res.outward = 'OUTPUT UPGRADED'
        }
      })
      .ready(function () {
        var siClient = CreateInstance()
          .client({type: 'http', port: '18997'})

        siClient.act('foo:1,bar:2', function (err, out) {
          if (err) return fin(err)
          Assert.equal(out.BAR, 13)
          Assert.equal(out.inward, 'INPUT UPGRADED')
          Assert.equal(out.outward, 'OUTPUT UPGRADED')
          fin()
        })
      })
  })

  it('reject HTTP remote act call in inward listen option', function (fin) {
    CreateInstance()
      .add('foo:1', function (args, done) {
        done(null, { BAR: args.bar })
      })
      .listen({type: 'http', port: '18996',
        inward: (context, data) => {
          var e = new Error('HTTP inward rejected!')
          e.error_code = 'inward_rejected'
          throw e
        }
      })
      .ready(function () {
        var siClient = CreateInstance()
          .client({type: 'http', port: '18996'})

        siClient.act('foo:1,bar:2', function (err, out) {
          Assert.equal(err.error_code, 'inward_rejected')
          if (err) return fin()
          fin(new Error('Inward does not reject remote call'))
        })
      })
  })

  it('reject HTTP remote act call in outward listen option', function (fin) {
    CreateInstance()
      .add('foo:1', function (args, done) {
        done(null, { BAR: args.bar })
      })
      .listen({type: 'http', port: '18995',
        outward: (context, data) => {
          var e = new Error('HTTP outward rejected!')
          e.error_code = 'outward_rejected'
          throw e
        }
      })
      .ready(function () {
        var siClient = CreateInstance()
          .client({type: 'http', port: '18995'})

        siClient.act('foo:1,bar:2', function (err, out) {
          Assert.equal(err.error_code, 'outward_rejected')
          if (err) return fin()
          fin(new Error('Outward does not reject remote call'))
        })
      })
  })

  it('catch HTTP remote act call error in outward listen option', function (fin) {
    CreateInstance()
      .add('foo:1', function (args, done) {
        done(new Error('Catchable failure'), {BAR: args.bar})
      })
      .listen({type: 'http', port: '18994',
        outward: (context, data) => {
          delete data.err
        }
      })
      .ready(function () {
        var siClient = CreateInstance()
          .client({type: 'http', port: '18994'})

        siClient.act('foo:1,bar:2', function (err, out) {
          if (err) return fin(err)
          Assert.equal(out.BAR, 2)
          fin()
        })
      })
  })
})

describe('Specific https', function () {
  it('Creates a seneca server running on port 8000 https and expects hex to be equal to #FF0000', function (done) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    function color () {
      this.add('color:red', function (args, done) {
        done(null, {hex: '#FF0000'})
      })
    }

    CreateInstance()
      .use(color)
      .listen({
        type: 'web',
        port: 8000,
        host: '127.0.0.1',
        protocol: 'https',
        serverOptions: {
          key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAuE1A7DmpJyffmXx1men/L3NJXIt/zXR4CoF0hZYloLBblwyV\nebQLfHq+Pn3E/xvFDIBVm6xDQhl9T+z/kLvCw2NSxkN5aSTjtwFA7iNPx9TqeUV/\n48ijQIR8gfrT7QV2Nl3pGk5RZfYzKEObddJeh7oSCAI9dLaBObcX5FfYrlsMg9S6\nHC3XI9HBlFtaMCpWmjY24xQlQ/yC98V6zkLcEQgqDo4TiOx6qNh0KDzoqpcV9HWm\n4E+m8K9JO5c1IR0y8Gv8aBnz/py6Pyw16pPm5MoxoMcWxSfdvx4TwhgALWvafVwO\nCSGMOphzAAid3QA6n1lc6J+asei5dk0cvxng3QIDAQABAoIBAEnFmpw0BHKI8mbk\nu8otMRlUQ2RI7pJV8Yr7AKJMVKl6jl7rCZYarJJaK3amL0mSWxDC+gGDNbTqsQ9i\nJXZQwggl5Mc50Qp2WrQxS0VHWzL5FhYO7L9H25kCrzf0KApzKjte4eTGvqxanWWb\nkknaOD6KC5erFeB3AUkR8f1T8IbxewCG/79RF3/DO2Obi0R9vOfoTNzuc6BKqIJ+\nvcS+z6+YEFSzbuDA4QuJiD3Uv/HlGzJf9HF2KJ6tjalo2nwmsWV1jXMX7dn13Rxa\ny12otOdqN7lVF1ulsoHBwbsX0PfDj5Kxa+i8fsry/4herYVwogEhOpFs0D552r9D\nKnUXIh0CgYEA42YXh5UDRIkJvhVcTdRpmUwv3C861Uk2Om3ibT7mREc32GanSMtU\n/JVBCCYUXhnSpHpazKL8iPEoHpX5HqxBhXEjwh054nKYrik69cn4ARxkXbiZsX3G\nTjNMB/NVVepu0xA1tA+viMNf11uI6peJa8F8Ldl1xI5DgJGMV/c/k7MCgYEAz3uA\nKe1wZeHEyrO2o9KnIPbPLkxV0/fxFkKi3g9F6NSUfTYUDpJN9m+wQA08DRTyzlOJ\nepmn12fCTQ51wYvFEjwajtDoRrGjbPVM6qz/N1XH18GaXUJ9z4eQKQ5SwHACh5W8\nfjJ4pPBHpDUF7CnV8PnDCJCFYtZdg1xvP0n1sS8CgYBTBXf7uSy7Pej/rB7KD44K\nOOWUVu385sDUrj+nsPoy3WmHKVtT2WCK4xceGYEAJh9gi4dRBQR8HseN+yU7zJoT\nVQ5AFZmHkl0p4MW07OsNxMbj7Ly4L3pSHKpakL2MI44YoudoeP2WSfZY0wN22qKC\nY96pgqZbf7EnZHw/tXZRvwKBgQCtYfkSEHcyzF3VPiTL9cbwBw/PEr9OaQ2wmnLb\nukuja7HCiKRuINjBrUfN3sFl9TGKNcjXCPx3Rx/ZoNHKsXA38r4GxpC0MtHsxXhH\nS9Xiee6MYB8M+/mCqThQ9sU0RuX2Q6zGkIq82oYjtKOEXNmJjE3tJEgy9gwjL+VP\nMBD+xQKBgGtfS/7BIznrLq2/29nWIUo9vNyXPNnobHi7doCdYoaBaadCCCK5Vn+K\nGiE8ZNneYZGsvfblggFUwdTrm/rRpiztRbtno/M+ikCn3GnKr0TBFj0u3DpCHHUR\nHk9Ukixv0t0zW6o3DhYS5WD12q6NwNNxkEMMF2/hIKsgCknPg9MG\n-----END RSA PRIVATE KEY-----\n',
          cert: '-----BEGIN CERTIFICATE-----\nMIIDtTCCAp2gAwIBAgIJAL6i6NpdpvunMA0GCSqGSIb3DQEBBQUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIEwpTb21lLVN0YXRlMSEwHwYDVQQKExhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTYwMzE1MTY1MjQwWhcNMTcwMzE1MTY1MjQwWjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECBMKU29tZS1TdGF0ZTEhMB8GA1UEChMYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEAuE1A7DmpJyffmXx1men/L3NJXIt/zXR4CoF0hZYloLBblwyVebQLfHq+\nPn3E/xvFDIBVm6xDQhl9T+z/kLvCw2NSxkN5aSTjtwFA7iNPx9TqeUV/48ijQIR8\ngfrT7QV2Nl3pGk5RZfYzKEObddJeh7oSCAI9dLaBObcX5FfYrlsMg9S6HC3XI9HB\nlFtaMCpWmjY24xQlQ/yC98V6zkLcEQgqDo4TiOx6qNh0KDzoqpcV9HWm4E+m8K9J\nO5c1IR0y8Gv8aBnz/py6Pyw16pPm5MoxoMcWxSfdvx4TwhgALWvafVwOCSGMOphz\nAAid3QA6n1lc6J+asei5dk0cvxng3QIDAQABo4GnMIGkMB0GA1UdDgQWBBT171ri\nK/l2kGOpMv2SrMC1X4Kw6zB1BgNVHSMEbjBsgBT171riK/l2kGOpMv2SrMC1X4Kw\n66FJpEcwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgTClNvbWUtU3RhdGUxITAfBgNV\nBAoTGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZIIJAL6i6NpdpvunMAwGA1UdEwQF\nMAMBAf8wDQYJKoZIhvcNAQEFBQADggEBAGf8ymbAUUOvoPpAKXzZ7oIWRomiATSq\nDveCiuxCiIb71wKtb+kffXxQNiNnslqooJiKMiof8HUxnH8NOJL+0Rss4V0golQH\n/YzoogVvcKQUnyMFHMRX9pklN8v8Wt9xIjqDbu3ltMu2VQ+ahepuZCuY+4YQgusf\nKCOYs2ycJzMJYbe0i80tlGqqhcoGuEuW70963126WUOhUQq5xaecJ9cwoVee2xEb\nXW9yt53KCyhpF/ALb8Orv66CCSV3rvbNgOdeNCnKNnr83VpCNCNRvmw1bYzK7LCW\nhTRQZonHX/PcdhW4i0Lqr2GPvA287eZK/riMcLP96mQIpX3A9NapwIk=\n-----END CERTIFICATE-----\n'
          // key: key,
          // cert: cert
        }
      })
      .ready(function () {
        CreateInstance()
          .client({
            type: 'http',
            port: 8000,
            host: '127.0.0.1',
            protocol: 'https'
          })
          .act('color:red', function (error, res) {
            if (error) {
              console.log(error)
            }
            expect(res.hex).to.be.equal('#FF0000')
            done()
          })
      })
  })

  it('Creates a seneca server running on port 8000 https and expects hex to be equal to #FF0000 (wreck client)', function (done) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    var StringDecoder = require('string_decoder').StringDecoder
    var Decoder = new StringDecoder('utf8')
    Wreck.request('get', 'https://127.0.0.1:8000/act?color=red', { rejectUnauthorized: false }, function (err, res) {
      res.on('data', function (d) {
        var data = Decoder.write(d)
        expect(data).to.be.equal('{"hex":"#FF0000"}')
        done()
      })
      expect(err).to.not.exist()
    })
  })
})
