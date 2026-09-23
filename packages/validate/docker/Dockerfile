# The HL7 FHIR validator, pinned, with its package cache warmed at build time.
#
#   docker build -t nuskha-validator packages/validate/docker
#   NUSKHA_VALIDATOR_IMAGE=nuskha-validator pnpm test
#
# The validator resolves some IG dependencies to their latest version when it
# first loads a package. Warming the cache here means a container validates
# against the packages present when the image was built.

FROM eclipse-temurin:21-jre

# Keep in step with packages/validate/src/pins.ts; a test checks this.
ARG VALIDATOR_VERSION=6.10.4
ARG VALIDATOR_SHA256=1106b9d58f9e363e47bea7c4fc065841e5fc91fe9d062775c3bfdd212bd653cc
ARG IG=ndhm.in#6.5.0

ADD https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VALIDATOR_VERSION}/validator_cli.jar /opt/validator/validator_cli.jar
RUN echo "${VALIDATOR_SHA256}  /opt/validator/validator_cli.jar" | sha256sum -c -

# Validate one trivial resource to make the validator download and cache the
# IG and everything it depends on. A failure here fails the build.
COPY warm.json /opt/validator/warm.json
RUN java -jar /opt/validator/validator_cli.jar /opt/validator/warm.json \
      -version 4.0.1 -ig "${IG}" -tx n/a \
 && chmod -R a+rX /root /opt/validator

WORKDIR /work
ENTRYPOINT ["java", "-jar", "/opt/validator/validator_cli.jar"]
