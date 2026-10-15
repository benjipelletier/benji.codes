// The version shown at the top, to tell production releases apart.
//
// 0.1.N, where N counts the commits on main that touch 重复习, the release's
// own commit included. Set it in the commit that goes to main, from a full
// clone (`git fetch --unshallow` first in a shallow one):
//
//   echo $(( $(git rev-list --count origin/main -- chongfuxi app/chongfuxi app/api/chongfuxi) + 1 ))
//
// (plus however many of the commits being pushed touch those paths besides
// this one). Vercel builds from a shallow clone, so it can't be counted there.
export const VERSION = "0.1.67";
