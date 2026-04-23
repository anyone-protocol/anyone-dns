variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
}

job "anyone-dns-live" {
  datacenters = ["ator-fin"]
  type = "service"
  namespace = "live-services"

  constraint {
    # attribute = "${meta.pool}"
    # value = "live-services"
    attribute = "${node.unique.id}"
    value = "ababa2ce-7129-d4b9-f9c4-b0e6f9d80f7f"
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
        volumes = ["local/default-anyone-hosts:/usr/src/app/default-anyone-hosts"]
      }

      env {
        VERSION = var.commit_sha
        PORT = "${NOMAD_PORT_dnsport}"
        DEFAULT_MAPPINGS_PATH = "/usr/src/app/default-anyone-hosts"
        DB_NAME = "uns_indexer"
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
        data = <<-EOH
        {{- range service "uns-record-indexer-postgres-live" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/db.env"
        env         = true
      }

      template {
        data = <<-EOF
        {{- with secret "kv/live-services/anyone-dns-live" }}
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASS="{{ .Data.data.DB_PASS }}"
        HIDDEN_SERVICE_HOSTNAME="{{ .Data.data.ANYONE_DNS_1_HS_HOSTNAME }}"
        HIDDEN_SERVICE_PUBLIC_KEY="{{ .Data.data.ANYONE_DNS_1_HS_ED25519_PUBLIC_KEY_BASE64 }}"
        HIDDEN_SERVICE_SECRET_KEY="{{ .Data.data.ANYONE_DNS_1_HS_ED25519_SECRET_KEY_BASE64 }}"
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
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ .Data.data.ANYONE_DNS_1_HS_HOSTNAME }}{{- end }}"
        destination = "/secrets/hidden-service/hostname"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ base64Decode .Data.data.ANYONE_DNS_1_HS_ED25519_PUBLIC_KEY_BASE64 }}{{- end }}"
        destination = "/secrets/hidden-service/hs_ed25519_public_key"
      }

      template {
        change_mode = "noop"
        data = "{{- with secret `kv/live-services/anyone-dns-live` }}{{ base64Decode .Data.data.ANYONE_DNS_1_HS_ED25519_SECRET_KEY_BASE64 }}{{- end }}"
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
        "traefik-ec.http.routers.dns-live.rule=Host(`dns.ec.anyone.tech`)",
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
