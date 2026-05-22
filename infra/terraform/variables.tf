variable "tenancy_ocid" {
  description = "Oracle Cloud tenancy OCID"
  type        = string
}

variable "user_ocid" {
  description = "Oracle Cloud user OCID"
  type        = string
}

variable "fingerprint" {
  description = "API key fingerprint"
  type        = string
}

variable "private_key_path" {
  description = "Path to OCI API private key"
  type        = string
}

variable "region" {
  description = "Oracle Cloud region"
  type        = string
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  description = "Compartment OCID (usually same as tenancy for free tier)"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key for VPS access"
  type        = string
}

variable "instance_shape" {
  description = "Compute shape. ARM free tier: VM.Standard.A1.Flex, AMD free tier: VM.Standard.E2.1.Micro"
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "nebula_lighthouse_ip" {
  description = "Nebula mesh IP for the lighthouse"
  type        = string
  default     = "10.0.0.254/24"
}
