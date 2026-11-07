FROM alpine:3.20

RUN apk add --no-cache openssh sudo shadow bash \
  && adduser -D -s /bin/bash tester \
  && echo 'tester:testpass' | chpasswd \
  && echo 'tester ALL=(ALL) ALL' > /etc/sudoers.d/tester \
  && echo 'Defaults !requiretty' >> /etc/sudoers.d/tester \
  && chmod 440 /etc/sudoers.d/tester \
  && ssh-keygen -A

RUN sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /etc/ssh/sshd_config

RUN printf '%s\n' \
  'PasswordAuthentication yes' \
  'KbdInteractiveAuthentication no' \
  'UsePAM no' \
  'PermitRootLogin no' \
  'AllowTcpForwarding yes' \
  'AllowAgentForwarding yes' \
  >> /etc/ssh/sshd_config

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]