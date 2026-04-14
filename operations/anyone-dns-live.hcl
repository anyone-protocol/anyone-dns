job "anyone-dns-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-services"

  constraint {
    attribute = "${meta.pool}"
    value = "live-services"
  }

  update {
    max_parallel     = 1
    canary           = 1
    min_healthy_time = "30s" # NB: May need to adjust this depending on relay bootstrapping time
    healthy_deadline = "5m"  # NB: May need to adjust this depending on relay bootstrapping time
    auto_revert      = true
    auto_promote     = true
  }

  group "anyone-dns-live-group" {
    count = 1

    network {
      mode = "bridge"
      port "hsport" {
        static = 80 # TODO -> does this need to be static?
      }
      port "dnsport" {
        host_network = "wireguard"
      }
    }

    task "anyone-dns-live-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/anyone-dns:${VERSION}"
        ports = ["dnsport"] # TODO -> do we need this?
      }

      env {
        VERSION = "[[ .commit_sha ]]"
        PORT="${NOMAD_PORT_dnsport}"
        ANYONE_API_BASE_URL="https://api-live.ec.anyone.tech"
      }

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOF
        {{- with secret "kv/live-services/anyone-dns-live" }}
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

    task "anyone-dns-live-relay-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/ator-protocol-dev-amd64:2d559746822beae5ee6a74729e619d9dcf796073" # anyone-dns-beta
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
        Nickname AnyoneDNSLive
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

      consul {}

      vault { role = "any1-nomad-workloads-controller" }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ .Data.data.ANYONE_1_HS_HOSTNAME }}{{- end }}"
        destination = "/secrets/hidden-service/hostname"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ base64Decode .Data.data.ANYONE_1_HS_ED25519_PUBLIC_KEY_BASE64 }}{{- end }}"
        destination = "/secrets/hidden-service/hs_ed25519_public_key"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ base64Decode .Data.data.ANYONE_1_HS_ED25519_SECRET_KEY_BASE64 }}{{- end }}"
        destination = "/secrets/hidden-service/hs_ed25519_secret_key"
      }

      resources {
        cpu = 1024
        memory = 1024
      }
    }

    service {
      name = "dns-service-live"
      port = "dnsport"
      tags = [
        "logging",
        "traefik-ec.enable=true",
        "traefik-ec.http.routers.dns-live.rule=Host(`dns-live.ec.anyone.tech`)",
        "traefik-ec.http.routers.dns-live.entrypoints=https",
        "traefik-ec.http.routers.dns-live.tls=true",
        "traefik-ec.http.routers.dns-live.tls.certresolver=anyoneresolver",
        "traefik-ec.http.routers.dns-live.middlewares=dns-live-ratelimit",
        "traefik-ec.http.middlewares.dns-live-ratelimit.ratelimit.average=100"
      ]
      check {
        name = "Anyone DNS live service check"
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
