export const SIGNALS =
  {
    linux: {
      129: 'SIGHUP', //  1
      130: 'SIGINT', //  2
      131: 'SIGQUIT', //  3
      132: 'SIGILL', //  4
      133: 'SIGTRAP', //  5
      134: 'SIGABRT', //  6
      135: 'SIGBUS', //  7
      136: 'SIGFPE', //  8
      137: 'SIGKILL', //  9
      138: 'SIGUSR1', // 10
      139: 'SIGSEGV', // 11
      140: 'SIGUSR2', // 12
      141: 'SIGPIPE', // 13
      142: 'SIGALRM', // 14
      143: 'SIGTERM', // 15
      144: 'SIGSTKFLT', // 16
      145: 'SIGCHLD', // 17
      146: 'SIGCONT', // 18
      147: 'SIGSTOP', // 19
      148: 'SIGTSTP', // 20
      149: 'SIGTTIN', // 21
      150: 'SIGTTOU', // 22
      151: 'SIGURG', // 23
      152: 'SIGXCPU', // 24
      153: 'SIGXFSZ', // 25
      154: 'SIGVTALRM', // 26
      155: 'SIGPROF', // 27
      156: 'SIGWINCH', // 28
      157: 'SIGIO', // 29
      158: 'SIGPWR', // 30
      159: 'SIGSYS', // 31
    },
  }[process.platform] ?? {}
