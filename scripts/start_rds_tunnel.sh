#!/bin/bash
# Cria um tunel SSM local para o RDS compartilhado Auth/Admin.
# Uso:
#   ./scripts/start_rds_tunnel.sh [porta_local]
#   BASTION_INSTANCE_ID=i-xxxx ./scripts/start_rds_tunnel.sh 5433

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
RDS_HOST="${RDS_HOST:-autonomia-auth-postgres-prod.cde6ocsqc6dk.us-east-1.rds.amazonaws.com}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_VPC_ID="${RDS_VPC_ID:-vpc-0a8017d897d762238}"
LOCAL_PORT="${1:-${LOCAL_PORT:-5433}}"

if [[ -z "${BASTION_INSTANCE_ID:-}" ]]; then
  echo "Buscando instancia SSM online na VPC ${RDS_VPC_ID}..."
  BASTION_INSTANCE_ID="$(
    aws ssm describe-instance-information \
      --region "$REGION" \
      --query "InstanceInformationList[?PingStatus=='Online'].InstanceId" \
      --output text \
    | tr '\t' '\n' \
    | while read -r instance_id; do
        [[ -z "$instance_id" ]] && continue
        instance_vpc="$(
          aws ec2 describe-instances \
            --region "$REGION" \
            --instance-ids "$instance_id" \
            --query "Reservations[0].Instances[0].VpcId" \
            --output text 2>/dev/null || true
        )"
        if [[ "$instance_vpc" == "$RDS_VPC_ID" ]]; then
          echo "$instance_id"
          break
        fi
      done
  )"
fi

if [[ -z "${BASTION_INSTANCE_ID:-}" || "$BASTION_INSTANCE_ID" == "None" ]]; then
  echo "Nenhuma instancia SSM online foi encontrada na VPC ${RDS_VPC_ID}." >&2
  echo "Inicie um bastion/EC2 com SSM na mesma VPC ou informe BASTION_INSTANCE_ID." >&2
  exit 1
fi

echo "Criando tunel SSM para o RDS compartilhado..."
echo "  Regiao: ${REGION}"
echo "  Bastion: ${BASTION_INSTANCE_ID}"
echo "  RDS: ${RDS_HOST}:${RDS_PORT}"
echo "  Local: localhost:${LOCAL_PORT}"
echo ""
echo "Mantenha este processo aberto. Pressione Ctrl+C para encerrar o tunel."
echo ""

aws ssm start-session \
  --target "$BASTION_INSTANCE_ID" \
  --region "$REGION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS_HOST\"],\"portNumber\":[\"$RDS_PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
