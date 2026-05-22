terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

# --- Networking ---

resource "oci_core_vcn" "nebula" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.1.0.0/16"]
  display_name   = "nebula-vcn"
}

resource "oci_core_internet_gateway" "nebula" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nebula.id
  display_name   = "nebula-igw"
}

resource "oci_core_route_table" "nebula" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nebula.id
  display_name   = "nebula-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.nebula.id
  }
}

resource "oci_core_subnet" "nebula" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nebula.id
  cidr_block     = "10.1.1.0/24"
  display_name   = "nebula-subnet"
  route_table_id = oci_core_route_table.nebula.id
  security_list_ids = [oci_core_security_list.nebula.id]
}

resource "oci_core_security_list" "nebula" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.nebula.id
  display_name   = "nebula-security-list"

  # Allow SSH inbound (for management)
  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  # Allow Nebula UDP inbound
  ingress_security_rules {
    protocol = "17" # UDP
    source   = "0.0.0.0/0"
    udp_options {
      min = 4242
      max = 4242
    }
  }

  # Allow all outbound
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

# --- Compute (free tier ARM) ---

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "lighthouse" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "nebula-lighthouse"
  shape               = var.instance_shape

  dynamic "shape_config" {
    for_each = var.instance_shape == "VM.Standard.A1.Flex" ? [1] : []
    content {
      ocpus         = 1
      memory_in_gbs = 6
    }
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.nebula.id
    assign_public_ip = true
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }
}
