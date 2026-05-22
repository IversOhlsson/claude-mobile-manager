output "lighthouse_public_ip" {
  description = "Public IP of the Nebula lighthouse VPS"
  value       = oci_core_instance.lighthouse.public_ip
}

output "lighthouse_instance_id" {
  description = "Instance OCID"
  value       = oci_core_instance.lighthouse.id
}
