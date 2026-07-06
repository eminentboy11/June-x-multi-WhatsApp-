     // Anti-* protection — run ALL checks in parallel so they don't queue behind each other
     if (isGroup) {
       const antispam     = commands.get('antispam');
       const antiviewonce = commands.get('antiviewonce');
       const antibot      = commands.get('antibot');
       const antiforward  = commands.get('antiforward');
       await Promise.allSettled([
         handleAntigroupmention(sock, msg, groupMetadata),
         handleAntigroupstatus(sock, msg, groupMetadata),
         handleAntiMedia(sock, msg, groupMetadata),
         antispam?.handleAntispam         ? antispam.handleAntispam(sock, msg, groupMetadata)         : Promise.resolve(),
         antiviewonce?.handleAntiviewonce ? antiviewonce.handleAntiviewonce(sock, msg)                : Promise.resolve(),
         antibot?.handleMessage           ? antibot.handleMessage(sock, msg, groupMetadata)           : Promise.resolve(),
         antiforward?.handleAntiforward   ? antiforward.handleAntiforward(sock, msg, groupMetadata)   : Promise.resolve(),
         handleAntibadword(sock, msg, groupMetadata),
       ]);
     }
