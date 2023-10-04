module.exports.SIGNALS =
  {
    linux: {
      129: 'SIGHUP',
      130: 'SIGINT',
      131: 'SIGQUIT',
      132: 'SIGILL',
      133: 'SIGTRAP',
      134: 'SIGABRT',
      135: 'SIGBUS',
      136: 'SIGFPE',
      139: 'SIGSEGV',
      140: 'SIGUSR2',
      141: 'SIGPIPE',
      142: 'SIGALRM',
      143: 'SIGTERM',
      144: 'SIGSTKFLT',
      152: 'SIGXCPU',
      153: 'SIGXFSZ',
      154: 'SIGVTALRM',
      155: 'SIGPROF',
      157: 'SIGIO',
      158: 'SIGPWR',
      159: 'SIGSYS',
    },
  }[process.platform] ?? {}
