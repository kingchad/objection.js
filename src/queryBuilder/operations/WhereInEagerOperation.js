import Promise from 'bluebird';
import ValidationError from '../../model/ValidationError'
import EagerOperation from './EagerOperation';

export default class WhereInEagerOperation extends EagerOperation {

  constructor(name, opt) {
    super(name, opt);

    this.relationsToFetch = [];
    this.omitProps = [];
  }

  clone(props) {
    const copy = super.clone();

    copy.relationsToFetch = this.relationsToFetch.slice();
    copy.omitProps = this.omitProps.slice();

    return copy;
  }

  call(builder, args) {
    const ret = super.call(builder, args);

    const modelClass = builder.modelClass();
    const relations = modelClass.getRelationArray();

    for (let i = 0, l = relations.length; i < l; ++i) {
      const relation = relations[i];
      const childExpression = this.expression.childExpression(relation.name);

      if (childExpression) {
        this.relationsToFetch.push({
          relation,
          childExpression
        });
      }
    }

    return ret;
  }

  onBeforeBuild(builder) {
    const addedSelects = {};

    for (let i = 0, l = this.relationsToFetch.length; i < l; ++i) {
      const relation = this.relationsToFetch[i].relation;
      const cols = relation.fullOwnerCol();

      for (let c = 0, lc = cols.length; c < lc; ++c) {
        const col = cols[c];

        if (!builder.hasSelection(col) && !addedSelects[col]) {
          this.omitProps.push(relation.ownerProp[c]);
          addedSelects[col] = true;
        }
      }
    }

    const cols = Object.keys(addedSelects);

    if (cols.length) {
      builder.select(cols);
    }
  }

  onAfterInternal(builder, result) {
    const modelClass = builder.modelClass();

    if (!result) {
      return result;
    }

    const models = Array.isArray(result) ? result : [result];

    if (!models.length || !(models[0] instanceof modelClass)) {
      return result;
    }

    const promises = [];

    this.expression.forEachChild(child => {
      let relation = modelClass.getRelations()[child.name];

      if (!relation) {
        throw new ValidationError({eager: `unknown relation "${child.name}" in an eager expression`});
      }
    });

    for (let i = 0, l = this.relationsToFetch.length; i < l; ++i) {
      const relation = this.relationsToFetch[i].relation;
      const childExpression = this.relationsToFetch[i].childExpression;

      promises.push(this._fetchRelation(builder, models, relation, childExpression));
    }

    return Promise.all(promises).then(() => {
      if (!this.omitProps.length) {
        return result;
      }

      for (let i = 0, l = result.length; i < l; ++i) {
        const model = result[i];

        for (let c = 0, lc = this.omitProps.length; c < lc; ++c) {
          modelClass.omitImpl(model, this.omitProps[c]);
        }
      }

      return result;
    })
  }

  _fetchRelation(builder, models, relation, childExpression) {
    const queryBuilder = relation.ownerModelClass.RelatedQueryBuilder
      .forClass(relation.relatedModelClass)
      .childQueryOf(builder)
      .eager(childExpression);

    const findOperation = relation.find(queryBuilder, models);
    findOperation.alwaysReturnArray = true;

    queryBuilder.callQueryBuilderOperation(findOperation, []);

    for (let i = 0, l = childExpression.args.length; i < l; ++i) {
      const filterName = childExpression.args[i];
      const filter = childExpression.filters[filterName];

      if (typeof filter !== 'function') {
        throw new ValidationError({eager: `could not find filter "${filterName}" for relation "${relation.name}"`});
      }

      filter(queryBuilder);
    }

    return queryBuilder;
  }
}