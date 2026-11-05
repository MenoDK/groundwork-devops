variable "region" {
  description = "AWS region."
  type        = string
  default     = "sa-east-1"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "groundwork"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be lower case letters, digits and hyphens, starting with a letter."
  }
}

variable "instance_type" {
  description = "Instance size. A burstable one is plenty for this workload."
  type        = string
  default     = "t3.small"
}

variable "admin_cidr" {
  description = "The one network ssh is allowed from. There is no default on purpose."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0" && var.admin_cidr != "::/0"
    error_message = "admin_cidr must be a CIDR block, and it must not be the whole internet."
  }
}

variable "web_cidrs" {
  description = "Networks allowed to reach ports 80 and 443 (for example a CDN's published ranges). Empty means nobody."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.web_cidrs : can(cidrhost(c, 0))])
    error_message = "every entry of web_cidrs must be a CIDR block."
  }
}

variable "tags" {
  description = "Tags added to everything."
  type        = map(string)
  default     = {}
}
