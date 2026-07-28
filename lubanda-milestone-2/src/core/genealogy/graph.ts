import type { PersonId } from "../contracts/identifiers.js";
import { compareCanonicalPersons } from "./canonical-order.js";
import type { GenealogySnapshot, Person } from "./types.js";

export interface GenealogyGraph {
  readonly personsById: ReadonlyMap<PersonId, Person>;
  readonly childrenByParentId: ReadonlyMap<PersonId, readonly PersonId[]>;
  readonly roots: readonly PersonId[];
  getAncestors(id: PersonId): readonly PersonId[];
  getDescendants(id: PersonId): readonly PersonId[];
  getSubtree(id: PersonId): readonly PersonId[];
  isTerminal(id: PersonId): boolean;
}

export const buildGenealogyGraph = (snapshot: GenealogySnapshot): GenealogyGraph => {
  const personsById = new Map<PersonId, Person>();
  for (const person of snapshot.persons) {
    if (personsById.has(person.id)) {
      throw new TypeError(`Snapshot contains duplicate PersonId: ${person.id}`);
    }
    personsById.set(person.id, person);
  }

  const mutableChildren = new Map<PersonId, PersonId[]>();
  const roots: PersonId[] = [];
  for (const person of snapshot.persons) {
    if (person.parentId === null) {
      roots.push(person.id);
      continue;
    }
    if (!personsById.has(person.parentId)) {
      throw new TypeError(`Snapshot contains missing parent: ${person.parentId}`);
    }
    const children = mutableChildren.get(person.parentId) ?? [];
    children.push(person.id);
    mutableChildren.set(person.parentId, children);
  }

  const compareIds = (left: PersonId, right: PersonId): number =>
    compareCanonicalPersons(
      personsById.get(left) as Person,
      personsById.get(right) as Person,
    );
  roots.sort(compareIds);
  const childrenByParentId = new Map<PersonId, readonly PersonId[]>();
  for (const [parentId, children] of mutableChildren) {
    childrenByParentId.set(parentId, Object.freeze([...children].sort(compareIds)));
  }

  const requirePerson = (id: PersonId): Person => {
    const person = personsById.get(id);
    if (!person) throw new RangeError(`Unknown PersonId: ${id}`);
    return person;
  };

  const getAncestors = (id: PersonId): readonly PersonId[] => {
    const ancestors: PersonId[] = [];
    let current = requirePerson(id).parentId;
    while (current !== null) {
      ancestors.push(current);
      current = requirePerson(current).parentId;
    }
    return ancestors;
  };

  const getDescendants = (id: PersonId): readonly PersonId[] => {
    requirePerson(id);
    const descendants: PersonId[] = [];
    const stack = [...(childrenByParentId.get(id) ?? [])].reverse();
    while (stack.length > 0) {
      const current = stack.pop() as PersonId;
      descendants.push(current);
      const children = childrenByParentId.get(current) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index] as PersonId);
      }
    }
    return descendants;
  };

  return {
    personsById,
    childrenByParentId,
    roots: Object.freeze(roots),
    getAncestors,
    getDescendants,
    getSubtree: (id) => Object.freeze([id, ...getDescendants(id)]),
    isTerminal: (id) => {
      requirePerson(id);
      return (childrenByParentId.get(id)?.length ?? 0) === 0;
    },
  };
};

