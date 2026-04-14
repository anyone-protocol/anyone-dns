job "anyone-dns-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"

  ## TODO -> Configure after development testing is complete
  reschedule { attempts = 0 }

  ## TODO -> Canary deployment

  ## NB: Needs public ip in anonrc for hidden service
  constraint {
    attribute = "${node.unique.id}"
    value = "2adb1799-9284-b274-ecf9-29218986ff16" # any1-hel-stage-1
  }

  group "anyone-dns-stage-group" {
    count = 1

    ## TODO -> Configure after development testing is complete
    restart {
      attempts = 0
      mode     = "fail"
    }

    network {
      mode = "bridge"
      port "hsport" {
        static = 80 # TODO -> does this need to be static?
      }
      port "dnsport" {
        host_network = "wireguard"
      }
    }

    task "anyone-dns-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/anyone-dns:${VERSION}"
        ports = ["dnsport"] # TODO -> do we need this?
      }

      env {
        # VERSION = "[[ .commit_sha ]]"
        VERSION="0e79e7639d7df88bc32f870dff00086482ef5f3c" # TODO -> remove after dev
        PORT="${NOMAD_PORT_dnsport}"
        ANYONE_API_BASE_URL="https://api-stage.ec.anyone.tech"
      }

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        JSON_RPC_URL="https://base-mainnet.infura.io/v3/{{ .Data.data.INFURA_API_KEY_1 }}"
        {{- end }}
        EOF
        destination = "secrets/config.env"
        env = true
      }

      resources {
        cpu = 512
        memory = 512
      }
    }

    task "anyone-dns-stage-relay-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/ator-protocol-dev-amd64:432dfcf59f24c1100c71522f0c5f08a8348618c4" # dev-anyone-dns
        volumes = [
          "local/anonrc:/etc/anon/anonrc",
          "secrets/hidden-service:/var/lib/anon/anyone-dns"
        ]
        ports = ["hsport"] # TODO -> do we need this?
      }

      template {
        change_mode = "noop"
        data = <<-EOF
        User anond
        Nickname AnyoneDNSStage
        AgreeToTerms 1
        SocksPort 0
        HiddenServiceDir /var/lib/anon/anyone-dns
        HiddenServicePort {{ env `NOMAD_PORT_hsport` }} localhost:{{ env `NOMAD_PORT_dnsport` }}
        DataDirectory /var/lib/anon
        Log info-err stdout
        ConfluxEnabled 0
        EOF
        destination = "local/anonrc"
      }

      vault { role = "any1-nomad-workloads-controller" }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/stage-services/anyone-dns-stage` }}{{ .Data.data.ANYONE_1_HS_HOSTNAME }}{{- end }}"
        destination = "/secrets/hidden-service/hostname"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/stage-services/anyone-dns-stage` }}{{ base64Decode .Data.data.ANYONE_1_HS_ED25519_PUBLIC_KEY_BASE64 }}{{- end }}"
        destination = "/secrets/hidden-service/hs_ed25519_public_key"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/stage-services/anyone-dns-stage` }}{{ base64Decode .Data.data.ANYONE_1_HS_ED25519_SECRET_KEY_BASE64 }}{{- end }}"
        destination = "/secrets/hidden-service/hs_ed25519_secret_key"
      }

      resources {
        cpu = 1024
        memory = 1024
      }
    }

    service {
      name = "dns-service-stage"
      port = "dnsport"
      tags = [
        "logging",
        "traefik-ec.enable=true",
        "traefik-ec.http.routers.dns-stage.rule=Host(`dns-stage.ec.anyone.tech`)",
        "traefik-ec.http.routers.dns-stage.entrypoints=https",
        "traefik-ec.http.routers.dns-stage.tls=true",
        "traefik-ec.http.routers.dns-stage.tls.certresolver=anyoneresolver",
        "traefik-ec.http.routers.dns-stage.middlewares=dns-stage-ratelimit",
        "traefik-ec.http.middlewares.dns-stage-ratelimit.ratelimit.average=100"
      ]
      check {
        name = "Anyone DNS stage service check"
        type = "http"
        path = "/"
        interval = "10s"
        timeout = "10s"
        address_mode = "alloc"
        check_restart {
          limit = 10
          grace = "30s"
        }
      }
    }
  }
}
