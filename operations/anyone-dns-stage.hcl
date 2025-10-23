job "anyone-dns-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  service {
    name = "api-service-stage"
    port = "http"
    tags = [
      "logging",
      "traefik-ec.enable=true",
      "traefik-ec.http.routers.api-stage.rule=Host(`dns-stage.ec.anyone.tech`)",
      "traefik-ec.http.routers.api-stage.entrypoints=https",
      "traefik-ec.http.routers.api-stage.tls=true",
      "traefik-ec.http.routers.api-stage.tls.certresolver=anyoneresolver",
      "traefik-ec.http.routers.api-stage.middlewares=api-stage-ratelimit",
      "traefik-ec.http.middlewares.api-stage-ratelimit.ratelimit.average=1000"
    ]
    check {
      name = "Api service check"
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

  group "anyone-dns-stage-group" {
    count = 1

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
  }
}
