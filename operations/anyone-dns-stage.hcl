job "anyone-dns-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"

  ## NB: Remove after development testing is complete
  reschedule { attempts = 0 }

  ## NB: Needs public ip in anonrc for hidden service
  constraint {
    attribute = "${node.unique.id}"
    value = "2adb1799-9284-b274-ecf9-29218986ff16" # any1-hel-stage-1
  }
  # constraint {
  #   attribute = "${meta.pool}"
  #   value = "stage"
  # }

  group "anyone-dns-stage-group" {
    count = 1

    ## NB: Remove after development testing is complete
    restart {
      attempts = 0
      mode     = "fail"
    }

    network {
      mode = "bridge"
      port "http" {
        host_network = "wireguard"
      }
    }

    task "anyone-dns-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/anyone-dns:${VERSION}"
        # network_mode = "bridge"
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
        cpu = 512
        memory = 512
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

  group "anyone-dns-stage-relay-group" {
    count = 1

    ## NB: Remove after development testing is complete
    restart {
      attempts = 0
      mode     = "fail"
    }

    network {
      port "relayor" {
        static = 9222
      }
    }

    task "anyone-dns-stage-relay-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/ator-protocol-dev-amd64:latest-pr"
        force_pull = true
        volumes = [
          "local/anonrc:/etc/anon/anonrc",
          "secrets/hidden-service:/var/lib/anon/anyone-dns"
        ]
        # network_mode = "host"
        ports = ["relayor"]
      }

      template {
        change_mode = "noop"
        data = <<-EOF
        User anond
        Nickname AnyoneDNSStage
        AgreeToTerms 1

        # # TODO -> move this to consul
        # {{- with secret "kv/stage-services/anyone-dns-stage" }}
        # Address {{ .Data.data.RELAY_IPV4_STAGE }}
        # {{- end }}

        # ORPort {{ env `NOMAD_HOST_PORT_relayor` }} IPv4Only
        # ORPort 9222 IPv4Only
        ORPort 0
        DataDirectory /var/lib/anon
        HiddenServiceDir /var/lib/anon/anyone-dns
        HiddenServicePort 80 {{ env `NOMAD_ADDR_http` }}

        SocksPort 0
        ControlSocket 0

        ## TODO ##
        # SafeLogging 1
        # UseEntryGuards 0
        # ProtocolWarnings 1
        # FetchDirInfoEarly 1
        # LogTimeGranularity 1
        # UseMicrodescriptors 0
        # FetchDirInfoExtraEarly 1
        # FetchUselessDescriptors 1
        # LearnCircuitBuildTimeout 0
        EOF
        destination = "local/anonrc"
      }

      vault { role = "any1-nomad-workloads-controller" }

      # TODO -> other keys

      template {
        change_mode = "noop"
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        {{ .Data.data.ANON_0_HS_HOSTNAME }}
        {{- end }}
        EOF
        destination = "/secrets/hidden-service/hostname"
      }

      template {
        change_mode = "noop"
        data = <<-EOF
        {{- with secret "kv/stage-services/anyone-dns-stage" }}
        {{ base64Decode .Data.data.ANON_0_HS_ED25519_PUBLIC_KEY_BASE64 }}
        {{- end }}
        EOF
        destination = "/secrets/hidden-service/hs_ed25519_public_key"
      }

      template {
        change_mode = "noop"
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

      # service {
      #   name = "dns-service-relay-stage"
      #   port = "relayor"
      #   tags     = ["logging"]
      #   check {
      #     name     = "dns-service-relay-stage check"
      #     type     = "tcp"
      #     interval = "10s"
      #     timeout  = "10s"
      #     check_restart {
      #       limit = 10
      #       grace = "30s"
      #     }
      #   }
      # }
    }
  }
}
