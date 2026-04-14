job "anyone-dns-stage" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  update {
    max_parallel     = 1
    canary           = 1
    min_healthy_time = "30s" # NB: May need to adjust this depending on relay bootstrapping time
    healthy_deadline = "5m"  # NB: May need to adjust this depending on relay bootstrapping time
    auto_revert      = true
    auto_promote     = true
  }

  group "anyone-dns-stage-group" {
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

    task "anyone-dns-stage-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/anyone-dns:${VERSION}"
        ports = ["dnsport"] # TODO -> do we need this?
        volumes = ["local/default-anyone-hosts:/usr/src/app/default-anyone-hosts"]
      }

      env {
        VERSION = "[[ .commit_sha ]]"
        PORT="${NOMAD_PORT_dnsport}"
        ANYONE_API_BASE_URL="https://api-stage.ec.anyone.tech"
        DEFAULT_MAPPINGS_PATH="/usr/src/app/default-anyone-hosts"
      }

      consul {}

      vault { role = "any1-nomad-workloads-controller" }

      template {
        change_mode = "noop"
        data = <<-EOF
        dns-stage-1.anyone.anyone hnsywhyh3zvvqzkmum7b3fxueii3bueeqjbwkfpngcqktxmubedrf5yd.anyone
        dns-stage-2.anyone.anyone xxfuq2xfwq7vxgadwywmtmfzeyk5j2oxhjhbn3onaq5h7yp7e3tpmkqd.anyone
        dns-stage-3.anyone.anyone xvtw2foswsovdutimyjo66zy3k26uehfcwdgrakut43cw4fto2djo2qd.anyone
        dns-live-1.anyone.anyone gadmrvl67444hgzrhsnhzknxaimfnzp6az3wq4d2j7hrf7th34elrrad.anyone
        dns-live-2.anyone.anyone kjlkfrfxquevo64qv4gssl3t52tiuay2muj7u4rox4llxboj4c4ypcid.anyone
        dns-live-3.anyone.anyone jntoblprbfgcpldwuzobmzsdjs6mtwtr3dtn3mtgdjnk6j7x2frcabad.anyone
        EOF
        destination = "local/default-anyone-hosts"
      }

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
        image = "ghcr.io/anyone-protocol/ator-protocol-stage-amd64:2d559746822beae5ee6a74729e619d9dcf796073" # anyone-dns-beta
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
