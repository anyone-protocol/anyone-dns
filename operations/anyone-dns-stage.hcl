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
    }

    task "anyone-dns-stage-task" {
      driver = "docker"

      config {
        image = "gchr.io/anyone-protocol/anyone-dns:${VERSION}"
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
