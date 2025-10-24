job "anyone-dns-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  group "anyone-dns-stage-group" {
    count = 1

    network {
      mode = "bridge"
      port "http" {
        host_network = "wireguard"
      }
      port "relaycontrol" {
        host_network = "wireguard"
      }
      port "relayor" {
        static = 443 # TODO ???
      }
    }

    task "anyone-dns-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/anyone-dns:${VERSION}"
      }

      env {
        VERSION = "[[ .commit_sha ]]"
        PORT="${NOMAD_PORT_http}"
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
        cpu = 1024
        memory = 1024
      }
    }

    service {
      name = "dns-service-stage"
      port = "http"
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
        name = "DNS stage service check"
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

    task "anyone-dns-stage-relay-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/ator-protocol-dev-amd64:latest-pr"
        force_pull = true
        volumes = [ "local/anonrc:/etc/anon/anonrc" ]
      }

      template {
        data = <<-EOF
        User anond
        Nickname AnyoneDNSStage
        AgreeToTerms 1

        ControlPort {{ env `NOMAD_PORT_relaycontrol_port` }}
        ORPort {{ env `NOMAD_PORT_relayor` }} IPv4Only
        DataDirectory /var/lib/anon
        HiddenServiceDir /var/lib/anon/anyone-dns
        HiddenServicePort 443 127.0.0.1:{{ env `NOMAD_PORT_http` }}

        ## TODO ??? ##
        SocksPort auto
        SafeLogging 1
        UseEntryGuards 0
        ProtocolWarnings 1
        FetchDirInfoEarly 1
        LogTimeGranularity 1
        UseMicrodescriptors 0
        FetchDirInfoExtraEarly 1
        FetchUselessDescriptors 1
        LearnCircuitBuildTimeout 0
        EOF
        destination = "local/anonrc"
      }

      vault { role = "any1-nomad-workloads-controller" }

      template {
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        {{ .Data.data.ANON_0_HS_HOSTNAME }}
        {{- end }}
        EOF
        destination = "/secrets/hidden-service/hostname"
      }

      template {
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        {{ base64Decode .Data.data.ANON_0_HS_ED25519_PUBLIC_KEY_BASE64 }}
        {{- end }}
        EOF
        destination = "/secrets/hidden-service/hs_ed25519_public_key"
      }

      template {
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        {{ base64Decode .Data.data.ANON_0_HS_ED25519_SECRET_KEY_BASE64 }}
        {{- end }}
        EOF
        destination = "/secrets/hidden-service/hs_ed25519_secret_key"
      }

      resources {
        cpu = 1024
        memory = 1024
      }
    }
  }
}
