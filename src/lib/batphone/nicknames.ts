/**
 * Nickname map
 *
 * Common English diminutives and the full names they stand for, so a
 * caller who says "bob" reaches "Robert Jones" and one who says "michael"
 * reaches "Mike Anderson". Pure data: the matcher looks names up in both
 * directions, and a name may belong to more than one group (a "kate" can
 * be a Katherine or a Kathleen).
 */

const GROUPS: readonly (readonly string[])[] = [
  ["michael", "mike", "mikey", "mick", "mickey"],
  ["robert", "rob", "robbie", "bob", "bobby", "bert"],
  ["elizabeth", "liz", "lizzie", "beth", "betsy", "eliza", "betty"],
  ["william", "will", "bill", "billy", "willy", "liam"],
  ["james", "jim", "jimmy", "jamie"],
  ["david", "dave", "davey"],
  ["katherine", "catherine", "kate", "katie", "kathy", "cathy", "kat", "cat"],
  ["kathleen", "kate", "kathy"],
  ["thomas", "tom", "tommy"],
  ["sarah", "sara", "sally"],
  ["jonathan", "jon", "jonny"],
  ["john", "johnny", "jack"],
  ["christopher", "chris", "topher"],
  ["christine", "christina", "chris", "chrissy", "tina"],
  ["richard", "rick", "ricky", "rich", "richie", "dick"],
  ["daniel", "dan", "danny"],
  ["joseph", "joe", "joey"],
  ["anthony", "tony"],
  ["edward", "ed", "eddie", "ted", "teddy", "ned"],
  ["charles", "charlie", "chuck", "chas"],
  ["matthew", "matt", "matty"],
  ["andrew", "andy", "drew"],
  ["nicholas", "nick", "nicky"],
  ["alexander", "alex", "sasha", "xander"],
  ["alexandra", "alex", "sasha", "lexi"],
  ["benjamin", "ben", "benny"],
  ["samuel", "sam", "sammy"],
  ["samantha", "sam", "sammy"],
  ["stephen", "steven", "steve", "stevie"],
  ["patrick", "pat", "paddy"],
  ["patricia", "pat", "patty", "trish", "tricia"],
  ["margaret", "maggie", "meg", "peggy", "marge"],
  ["jennifer", "jen", "jenny"],
  ["jessica", "jess", "jessie"],
  ["rebecca", "becca", "becky"],
  ["susan", "sue", "susie", "suzy"],
  ["deborah", "debbie", "deb"],
  ["abigail", "abby", "gail"],
  ["victoria", "vicky", "tori"],
  ["timothy", "tim", "timmy"],
  ["gregory", "greg"],
  ["jeffrey", "jeff"],
  ["kenneth", "ken", "kenny"],
  ["ronald", "ron", "ronnie"],
  ["donald", "don", "donnie"],
  ["lawrence", "larry"],
  ["henry", "hank", "harry"],
  ["theodore", "theo", "ted", "teddy"],
  ["zachary", "zach", "zack"],
  ["frederick", "fred", "freddie"],
  ["peter", "pete"],
  ["philip", "phil"],
  ["raymond", "ray"],
  ["leonard", "leo", "lenny"],
  ["eugene", "gene"],
  ["walter", "walt"],
  ["albert", "al", "bert"],
  ["vincent", "vince", "vinny"],
  ["louis", "lou", "louie"],
  ["maximilian", "max"],
  ["nathaniel", "nate", "nathan"],
  ["oliver", "ollie"],
  ["joshua", "josh"],
  ["dorothy", "dot", "dottie"],
  ["barbara", "barb", "babs"],
  ["frances", "fran", "frankie"],
  ["francis", "frank", "frankie"],
  ["florence", "flo"],
  ["josephine", "jo", "josie"],
  ["eleanor", "ellie", "nell", "nora"],
  ["emily", "em", "emmy"],
  ["emma", "em", "emmy"],
  ["isabella", "bella", "izzy"],
  ["gabriel", "gabe"],
  ["gabriella", "gabby"],
  ["madeline", "maddie"],
  ["olivia", "liv", "livvy"],
  ["natalie", "nat"],
  ["nathaniel", "nat"],
  ["veronica", "ronnie"],
  ["virginia", "ginny"],
  ["penelope", "penny"],
  ["caroline", "carrie"],
  ["angela", "angie"],
];

const INDEX: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of GROUPS) {
    for (const name of group) {
      const set = map.get(name) ?? new Set<string>();
      for (const other of group) if (other !== name) set.add(other);
      map.set(name, set);
    }
  }
  return map;
})();

const EMPTY: ReadonlySet<string> = new Set();

/** Every name that shares a nickname group with `name` (lower-case, no punctuation). */
export function nicknameVariants(name: string): ReadonlySet<string> {
  return INDEX.get(name) ?? EMPTY;
}

/** True when the two names are the same or belong to one nickname group. */
export function areNicknames(a: string, b: string): boolean {
  if (a === b) return true;
  return nicknameVariants(a).has(b);
}
